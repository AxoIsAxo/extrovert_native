use std::sync::Arc;
use std::time::Duration;

use governor::{Quota, RateLimiter, clock::DefaultClock, state::InMemoryState, state::NotKeyed};
use reqwest::{Client, Response};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::json;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::auth;
use crate::config;
use crate::error::{Error, Result};

pub struct ApiClient {
    http: Client,
    rate_limiter: Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>>,
    refresh_lock: Mutex<()>,
}

impl ApiClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .use_rustls_tls()
            .timeout(Duration::from_secs(30))
            .user_agent("ExtrovertNative/0.1")
            .build()
            .expect("failed to build reqwest client");

        let quota = Quota::per_minute(std::num::NonZeroU32::new(100).unwrap());
        let rate_limiter = Arc::new(RateLimiter::direct(quota));

        Self { http, rate_limiter, refresh_lock: Mutex::new(()) }
    }

    fn get_token(&self) -> Result<String> {
        auth::get_access_token()
            .map_err(|e| Error::Other(e.to_string()))?
            .ok_or(Error::NotAuthenticated)
    }

    async fn try_refresh(&self) -> Result<bool> {
        let refresh_token = match auth::get_refresh_token()
            .map_err(|e| Error::Other(e.to_string()))?
        {
            Some(t) => t,
            None => return Ok(false),
        };

        let body = json!({
            "grant_type": "refresh_token",
            "client_id": config::CLIENT_ID,
            "refresh_token": refresh_token,
        });

        let resp = self.http.post(config::token_url()).json(&body).send().await?;

        if !resp.status().is_success() {
            let _ = auth::clear_tokens();
            return Ok(false);
        }

        let token_resp: config::TokenResponse = resp.json().await?;
        auth::store_access_token(&token_resp.access_token)
            .map_err(|e| Error::Other(e.to_string()))?;
        auth::store_refresh_token(&token_resp.refresh_token)
            .map_err(|e| Error::Other(e.to_string()))?;
        Ok(true)
    }

    async fn handle_401(&self) -> Result<bool> {
        let _guard = self.refresh_lock.lock().await;
        self.try_refresh().await
    }

    /// Force a token refresh if the stored refresh token exists. Used by the
    /// E2EE bridge (e2ee_refresh_token command) when the webview's fetch-based
    /// calls hit a 401 — those don't go through ApiClient, so refresh can't be
    /// transparent there.
    pub async fn refresh_if_needed(&self) -> Result<()> {
        let _guard = self.refresh_lock.lock().await;
        let _ = self.try_refresh().await;
        Ok(())
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.rate_limiter.until_ready().await;
        let url = format!("{}{}", config::api_base(), path);
        let token = self.get_token()?;

        let resp = self.http.get(&url).bearer_auth(&token).send().await?;
        let resp = if resp.status() == 401 {
            if self.handle_401().await? {
                let token = self.get_token()?;
                self.http.get(&url).bearer_auth(&token).send().await?
            } else {
                return Err(Error::NotAuthenticated);
            }
        } else { resp };

        let resp = check_status(resp).await?;
        extract_data::<T>(resp).await
    }

    pub async fn get_with_query<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, Option<String>)],
    ) -> Result<T> {
        self.rate_limiter.until_ready().await;
        let url = format!("{}{}", config::api_base(), path);
        let token = self.get_token()?;

        let resp = build_get(&self.http, &url, &token, query).await?;
        let resp = if resp.status() == 401 {
            if self.handle_401().await? {
                let token = self.get_token()?;
                build_get(&self.http, &url, &token, query).await?
            } else {
                return Err(Error::NotAuthenticated);
            }
        } else { resp };

        let resp = check_status(resp).await?;
        extract_data::<T>(resp).await
    }

    pub async fn post<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        self.rate_limiter.until_ready().await;
        let url = format!("{}{}", config::api_base(), path);
        let token = self.get_token()?;

        let resp = self.http.post(&url).bearer_auth(&token).json(body).send().await?;
        let resp = if resp.status() == 401 {
            if self.handle_401().await? {
                let token = self.get_token()?;
                self.http.post(&url).bearer_auth(&token).json(body).send().await?
            } else {
                return Err(Error::NotAuthenticated);
            }
        } else { resp };

        let resp = check_status(resp).await?;
        extract_data::<T>(resp).await
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        self.rate_limiter.until_ready().await;
        let url = format!("{}{}", config::api_base(), path);
        let token = self.get_token()?;

        let resp = self.http.delete(&url).bearer_auth(&token).send().await?;
        let resp = if resp.status() == 401 {
            if self.handle_401().await? {
                let token = self.get_token()?;
                self.http.delete(&url).bearer_auth(&token).send().await?
            } else {
                return Err(Error::NotAuthenticated);
            }
        } else { resp };

        check_status(resp).await?;
        Ok(())
    }

    pub async fn patch<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        self.rate_limiter.until_ready().await;
        let url = format!("{}{}", config::api_base(), path);
        let token = self.get_token()?;

        let resp = self.http.patch(&url).bearer_auth(&token).json(body).send().await?;
        let resp = if resp.status() == 401 {
            if self.handle_401().await? {
                let token = self.get_token()?;
                self.http.patch(&url).bearer_auth(&token).json(body).send().await?
            } else {
                return Err(Error::NotAuthenticated);
            }
        } else { resp };

        let resp = check_status(resp).await?;
        extract_data::<T>(resp).await
    }
}

async fn build_get(
    http: &Client,
    url: &str,
    token: &str,
    query: &[(&str, Option<String>)],
) -> Result<Response> {
    let mut req = http.get(url).bearer_auth(token);
    for (k, v) in query {
        if let Some(val) = v {
            req = req.query(&[(*k, val.as_str())]);
        }
    }
    Ok(req.send().await?)
}

async fn check_status(resp: Response) -> Result<Response> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        let status = resp.status().as_u16();
        let detail = resp.text().await.unwrap_or_default();
        Err(Error::Api { status, detail })
    }
}

pub async fn exchange_code(
    code: &str,
    code_verifier: &str,
) -> Result<config::TokenResponse> {
    let http = Client::builder()
        .use_rustls_tls()
        .timeout(Duration::from_secs(30))
        .user_agent("ExtrovertNative/0.1")
        .build()
        .expect("failed to build reqwest client for token exchange");

    let body = json!({
        "grant_type": "authorization_code",
        "client_id": config::CLIENT_ID,
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": config::redirect_uri(),
    });

    let resp = http.post(config::token_url()).json(&body).send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let detail = resp.text().await.unwrap_or_default();
        return Err(Error::Api { status, detail });
    }

    Ok(resp.json().await?)
}

/// Some endpoints wrap responses in { data: … }, others return the object directly.
/// Paginated responses have a top-level `pagination` field — pass them through
/// so types like `Paginated<T>` can deserialize.
async fn extract_data<T: DeserializeOwned>(resp: Response) -> Result<T> {
    let v: Value = resp.json().await.map_err(Error::Network)?;
    // Paginated responses have both `data` and `pagination` — pass through whole value.
    if v.get("pagination").is_some() {
        return serde_json::from_value(v).map_err(Error::Json);
    }
    // Some endpoints wrap data in { "data": … }, others return the object directly.
    if let Some(data) = v.get("data") {
        serde_json::from_value(data.clone()).map_err(Error::Json)
    } else {
        serde_json::from_value(v).map_err(Error::Json)
    }
}
