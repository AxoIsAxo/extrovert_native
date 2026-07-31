use serde::{Deserialize, Serialize};
use serde::de;

pub type MsEpoch = i64;

pub fn string_or_int<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: de::Deserializer<'de>,
{
    struct StringOrIntVisitor;
    impl de::Visitor<'_> for StringOrIntVisitor {
        type Value = String;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a string or integer")
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(v.to_owned())
        }
        fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
            Ok(v.to_string())
        }
        fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
            Ok(v.to_string())
        }
    }
    deserializer.deserialize_any(StringOrIntVisitor)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Account {
    pub id: String,
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub bio: String,
    pub created_at: MsEpoch,
    #[serde(default)]
    pub statuses_count: i64,
    #[serde(default)]
    pub followers_count: i64,
    #[serde(default)]
    pub following_count: i64,
    #[serde(default)]
    pub is_following: bool,
    #[serde(default)]
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Status {
    pub id: String,
    #[serde(rename = "type")]
    pub status_type: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub media_path: Option<String>,
    pub created_at: MsEpoch,
    pub account: Option<Account>,
    #[serde(default)]
    pub likes_count: i64,
    #[serde(default)]
    pub shares_count: i64,
    #[serde(default)]
    pub comments_count: i64,
    #[serde(default)]
    pub liked: bool,
    #[serde(default)]
    pub shared: bool,
    #[serde(default)]
    pub repost_of_id: Option<String>,
    #[serde(default)]
    pub is_own: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Conversation {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar: Option<String>,
    pub last_message: Option<String>,
    pub last_at: Option<MsEpoch>,
    pub unread: i64,
    #[serde(default)]
    pub last_from: Option<String>,
    #[serde(default)]
    pub last_proto: Option<String>,
    #[serde(default)]
    pub last_key_for_sender: Option<String>,
    #[serde(default)]
    pub last_key_for_recipient: Option<String>,
    #[serde(default)]
    pub last_sender_ciphertext: Option<String>,
    #[serde(default)]
    pub sender_curve: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DirectMessage {
    #[serde(deserialize_with = "string_or_int")]
    pub id: String,
    #[serde(deserialize_with = "string_or_int")]
    pub from_id: String,
    #[serde(deserialize_with = "string_or_int")]
    pub to_id: String,
    pub body: String,
    pub created_at: MsEpoch,
    pub edited_at: Option<MsEpoch>,
    pub key_for_sender: Option<String>,
    pub key_for_recipient: Option<String>,
    #[serde(default)]
    pub proto: Option<String>,
    #[serde(default)]
    pub sender_ciphertext: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RoomSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub member_count: i64,
    pub is_member: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RoomChannel {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RoomMember {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RoomDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub html: String,
    pub css: String,
    pub is_public: bool,
    pub is_member: bool,
    pub channels: Vec<RoomChannel>,
    #[serde(default)]
    pub members: Vec<RoomMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RoomMessage {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar: Option<String>,
    pub body: String,
    pub created_at: MsEpoch,
    pub edited_at: Option<MsEpoch>,
    #[serde(default)]
    pub proto: Option<String>,
    #[serde(default)]
    pub ciphertext: Option<String>,
    #[serde(default)]
    pub group_session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MessagesResponse {
    pub messages: Vec<RoomMessage>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Notification {
    pub id: String,
    #[serde(rename = "type")]
    pub notif_type: String,
    pub created_at: MsEpoch,
    pub read: bool,
    pub account: Account,
    #[serde(default)]
    pub post_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Pagination {
    pub next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paginated<T> {
    pub data: Vec<T>,
    #[serde(default)]
    pub pagination: Pagination,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MyKeysResponse {
    pub public_key: Option<String>,
    pub encrypted_private_key: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RecipientKeyResponse {
    pub public_key: Option<String>,
}
