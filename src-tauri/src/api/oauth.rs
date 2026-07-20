use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::auth::generate_pkce;
use crate::config;
use crate::error::{Error, Result};

#[derive(Debug, Serialize, Deserialize)]
pub struct PendingFlow {
    pub verifier: String,
    pub state: String,
    pub nonce: String,
}

pub static PENDING: Mutex<Option<PendingFlow>> = Mutex::new(None);

fn pending_file_path() -> PathBuf {
    crate::auth::store::data_dir().join("pending.json")
}

fn save_pending_to_disk(pending: &PendingFlow) {
    if let Ok(data) = serde_json::to_string(pending) {
        let _ = std::fs::write(pending_file_path(), data);
    }
}

fn load_pending_from_disk() -> Option<PendingFlow> {
    let path = pending_file_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn clear_pending_on_disk() {
    let _ = std::fs::remove_file(pending_file_path());
}

pub fn take_pending() -> Option<PendingFlow> {
    let from_mem = PENDING.lock().unwrap().take();
    if from_mem.is_some() {
        clear_pending_on_disk();
        from_mem
    } else {
        let from_disk = load_pending_from_disk();
        if from_disk.is_some() {
            clear_pending_on_disk();
        }
        from_disk
    }
}

pub fn build_authorize_url() -> String {
    let pkce = generate_pkce();
    let state = crate::auth::random_state();
    let nonce = crate::auth::random_nonce();

    let url = config::authorize_url(config::CLIENT_ID, &pkce.challenge, &state, &nonce);

    let pending = PendingFlow {
        verifier: pkce.verifier,
        state,
        nonce,
    };
    save_pending_to_disk(&pending);
    *PENDING.lock().unwrap() = Some(pending);

    url
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Deserialize)]
struct JwkKey {
    n: String,
    e: String,
}

pub async fn verify_id_token(
    id_token: &str,
    expected_nonce: &str,
    client_id: &str,
) -> Result<()> {
    let decoding_key = fetch_decoding_key().await?;

    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_issuer(&[config::issuer()]);
    validation.set_audience(&[client_id]);

    let token_data =
        jsonwebtoken::decode::<Claims>(id_token, &decoding_key, &validation)?;

    if let Some(n) = &token_data.claims.nonce {
        if n != expected_nonce {
            return Err(Error::Oauth("nonce mismatch".into()));
        }
    }

    Ok(())
}

async fn fetch_decoding_key() -> Result<jsonwebtoken::DecodingKey> {
    let resp = reqwest::get(config::jwks_url()).await?;
    let jwks: JwksResponse = resp.json().await?;
    let key = jwks
        .keys
        .into_iter()
        .next()
        .ok_or_else(|| Error::Oauth("JWKS has no keys".into()))?;

    let pem =
        jwk_to_rsa_public_key_pem(&key.n, &key.e)
            .map_err(|e| Error::Other(format!("build pem: {e}")))?;

    jsonwebtoken::DecodingKey::from_rsa_pem(pem.as_bytes())
        .map_err(|e| Error::Other(format!("from_rsa_pem: {e}")))
}

fn jwk_to_rsa_public_key_pem(n_b64: &str, e_b64: &str) -> Result<String> {
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let n = engine.decode(n_b64).unwrap_or_else(|_| {
        base64::engine::general_purpose::STANDARD
            .decode(n_b64)
            .unwrap()
    });
    let e = engine.decode(e_b64).unwrap_or_else(|_| {
        base64::engine::general_purpose::STANDARD
            .decode(e_b64)
            .unwrap()
    });

    let der = build_rsa_public_key_der(&n, &e);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&der);

    let mut pem = String::from("-----BEGIN RSA PUBLIC KEY-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        pem.push_str(&String::from_utf8_lossy(chunk));
        pem.push('\n');
    }
    pem.push_str("-----END RSA PUBLIC KEY-----");
    Ok(pem)
}

fn build_rsa_public_key_der(n: &[u8], e: &[u8]) -> Vec<u8> {
    let n_der = encode_integer(n);
    let e_der = encode_integer(e);
    let content = [n_der.as_slice(), e_der.as_slice()].concat();
    let mut der = vec![0x30];
    der.extend(encode_length(content.len()));
    der.extend(content);
    der
}

fn encode_integer(bytes: &[u8]) -> Vec<u8> {
    let value = if bytes.first().copied().unwrap_or(0) >= 0x80 {
        let mut v = vec![0x00];
        v.extend_from_slice(bytes);
        v
    } else {
        let mut trimmed = bytes.to_vec();
        while trimmed.len() > 1 && trimmed[0] == 0 && trimmed[1] < 0x80 {
            trimmed.remove(0);
        }
        trimmed
    };
    let mut der = vec![0x02];
    der.extend(encode_length(value.len()));
    der.extend(value);
    der
}

fn encode_length(len: usize) -> Vec<u8> {
    if len < 128 {
        vec![len as u8]
    } else if len < 256 {
        vec![0x81, len as u8]
    } else if len < 65536 {
        vec![0x82, (len >> 8) as u8, (len & 0xff) as u8]
    } else {
        panic!("length too large for DER");
    }
}

#[derive(Debug, Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    exp: u64,
    #[serde(default)]
    nonce: Option<String>,
    #[serde(default)]
    sub: Option<String>,
}
