use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub struct PkceParams {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce() -> PkceParams {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge_bytes = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(challenge_bytes);
    PkceParams { verifier, challenge }
}

pub fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn random_state() -> String { random_hex(16) }
pub fn random_nonce() -> String { random_hex(16) }
