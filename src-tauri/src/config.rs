use serde::Deserialize;

const ISSUER: &str = "https://extrovert.redforged.eu";
const API_BASE: &str = "https://extrovert.redforged.eu";
const REDIRECT_URI: &str = "im.extrovert.mobile://oauth/callback";
const SCOPES: &str = "openid profile read write follow media.write notifications read:direct write:direct";

pub const CLIENT_ID: &str = "86add8101780d8afeb3b258e22743b2b2ff74f46d903c3ff";

pub fn issuer() -> &'static str { ISSUER }
pub fn api_base() -> &'static str { API_BASE }
pub fn redirect_uri() -> &'static str { REDIRECT_URI }
pub fn scopes() -> &'static str { SCOPES }

pub fn authorize_url(client_id: &str, code_challenge: &str, state: &str, nonce: &str) -> String {
    format!(
        "{API_BASE}/api/v1/oauth/authorize?client_id={cid}&redirect_uri={ru}&response_type=code&scope={sc}&state={st}&nonce={no}&code_challenge={cc}&code_challenge_method=S256",
        cid = urlencoding::encode(client_id),
        ru = urlencoding::encode(REDIRECT_URI),
        sc = urlencoding::encode(SCOPES),
        st = state,
        no = nonce,
        cc = code_challenge,
    )
}

pub fn token_url() -> String { format!("{API_BASE}/api/v1/oauth/token") }
pub fn jwks_url() -> String { format!("{ISSUER}/.well-known/jwks.json") }
pub fn userinfo_url() -> String { format!("{API_BASE}/api/v1/oauth/userinfo") }

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
    pub expires_in: u64,
    pub refresh_token: String,
    #[serde(default)]
    pub id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OAuthError {
    pub error: String,
    #[serde(default)]
    pub error_description: Option<String>,
}
