use std::sync::Mutex;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine as _;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use rsa::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey},
    Oaep, RsaPrivateKey, RsaPublicKey,
};
use sha2::Sha256;

use crate::error::{Error, Result};

const ITERATIONS: u32 = 600_000;
const BASE64: base64::engine::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

pub struct E2eeContext {
    pub user_id: String,
    pub kek: [u8; 32],
    pub private_key: RsaPrivateKey,
    pub public_key: RsaPublicKey,
    pub public_key_pem: String,
}

static E2EE: Mutex<Option<E2eeContext>> = Mutex::new(None);

pub fn set_state(ctx: E2eeContext) {
    *E2EE.lock().unwrap() = Some(ctx);
}

pub fn clear_state() {
    *E2EE.lock().unwrap() = None;
}

pub fn is_ready() -> bool {
    E2EE.lock().unwrap().is_some()
}

pub fn get_private_key() -> Option<RsaPrivateKey> {
    E2EE.lock().unwrap().as_ref().map(|c| c.private_key.clone())
}

pub fn get_public_key() -> Option<RsaPublicKey> {
    E2EE.lock().unwrap().as_ref().map(|c| c.public_key.clone())
}

pub fn get_public_key_pem() -> Option<String> {
    E2EE.lock().unwrap().as_ref().map(|c| c.public_key_pem.clone())
}

pub fn get_user_id() -> Option<String> {
    E2EE.lock().unwrap().as_ref().map(|c| c.user_id.clone())
}

pub fn derive_kek(password: &str, username: &str) -> [u8; 32] {
    let salt = username.to_lowercase();
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt.as_bytes(), ITERATIONS, &mut key);
    key
}

pub fn generate_key_pair() -> Result<(RsaPrivateKey, String)> {
    let mut rng = rand::rngs::OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 4096)
        .map_err(|e| Error::E2ee(format!("key generation failed: {e}")))?;
    let public_key = private_key.to_public_key();
    let spki_der = public_key
        .to_public_key_der()
        .map_err(|e| Error::E2ee(format!("public key export failed: {e}")))?;
    let public_key_pem = BASE64.encode(spki_der.as_bytes());
    Ok((private_key, public_key_pem))
}

pub fn public_key_from_pem_b64(pem_b64: &str) -> Result<RsaPublicKey> {
    let der = BASE64
        .decode(pem_b64)
        .map_err(|e| Error::E2ee(format!("invalid pubkey base64: {e}")))?;
    RsaPublicKey::from_public_key_der(&der)
        .map_err(|e| Error::E2ee(format!("invalid pubkey der: {e}")))
}

pub fn wrap_private_key(private_key: &RsaPrivateKey, kek: &[u8; 32]) -> Result<String> {
    let pkcs8 = private_key
        .to_pkcs8_der()
        .map_err(|e| Error::E2ee(format!("private key export failed: {e}")))?;
    let plaintext = pkcs8.as_bytes();

    let mut iv = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut iv);

    let key = Key::<Aes256Gcm>::from_slice(kek);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&iv);

    let ciphertext =
        cipher.encrypt(nonce, plaintext).map_err(|e| Error::E2ee(format!("aes encrypt failed: {e}")))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&iv);
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

pub fn unwrap_private_key(encrypted_b64: &str, kek: &[u8; 32]) -> Result<RsaPrivateKey> {
    let combined = BASE64
        .decode(encrypted_b64)
        .map_err(|e| Error::E2ee(format!("invalid encrypted key base64: {e}")))?;

    if combined.len() < 12 {
        return Err(Error::E2ee("encrypted key too short".into()));
    }

    let iv = &combined[..12];
    let ct = &combined[12..];

    let key = Key::<Aes256Gcm>::from_slice(kek);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(iv);

    let plaintext = cipher
        .decrypt(nonce, ct)
        .map_err(|_| Error::E2ee("wrong password or corrupted private key".into()))?;

    RsaPrivateKey::from_pkcs8_der(&plaintext)
        .map_err(|e| Error::E2ee(format!("invalid private key pkcs8: {e}")))
}

pub fn encrypt_message(
    plaintext: &str,
    recipient_pem_b64: &str,
    own_public_key: &RsaPublicKey,
) -> Result<(String, String, String)> {
    let mut aes_key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut aes_key);

    let mut iv = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut iv);

    let key = Key::<Aes256Gcm>::from_slice(&aes_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&iv);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| Error::E2ee(format!("body encrypt failed: {e}")))?;

    let mut body_combined = Vec::with_capacity(12 + ciphertext.len());
    body_combined.extend_from_slice(&iv);
    body_combined.extend_from_slice(&ciphertext);
    let body_b64 = BASE64.encode(&body_combined);

    let recipient_pub = public_key_from_pem_b64(recipient_pem_b64)?;
    let mut rng = rand::rngs::OsRng;
    let enc_for_recipient = recipient_pub
        .encrypt(&mut rng, Oaep::new::<Sha256>(), &aes_key)
        .map_err(|e| Error::E2ee(format!("rsa encrypt for recipient failed: {e}")))?;
    let key_for_recipient = BASE64.encode(&enc_for_recipient);

    let enc_for_sender = own_public_key
        .encrypt(&mut rng, Oaep::new::<Sha256>(), &aes_key)
        .map_err(|e| Error::E2ee(format!("rsa encrypt for sender failed: {e}")))?;
    let key_for_sender = BASE64.encode(&enc_for_sender);

    Ok((body_b64, key_for_sender, key_for_recipient))
}

pub fn decrypt_message(body_b64: &str, key_b64: &str, private_key: &RsaPrivateKey) -> Result<String> {
    let enc_key = BASE64
        .decode(key_b64)
        .map_err(|e| Error::E2ee(format!("invalid key base64: {e}")))?;

    let padding = Oaep::new::<Sha256>();
    let aes_key = private_key
        .decrypt(padding, &enc_key)
        .map_err(|e| Error::E2ee(format!("rsa decrypt failed: {e}")))?;

    let data = BASE64
        .decode(body_b64)
        .map_err(|e| Error::E2ee(format!("invalid body base64: {e}")))?;

    if data.len() < 12 {
        return Err(Error::E2ee("body too short".into()));
    }

    let iv = &data[..12];
    let ct = &data[12..];

    let key = Key::<Aes256Gcm>::from_slice(&aes_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(iv);

    let plaintext = cipher
        .decrypt(nonce, ct)
        .map_err(|e| Error::E2ee(format!("aes decrypt failed: {e}")))?;

    String::from_utf8(plaintext).map_err(|e| Error::E2ee(format!("invalid utf-8: {e}")))
}
