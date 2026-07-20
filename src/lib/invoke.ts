import { invoke } from "@tauri-apps/api/core";

export interface Account {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  bio: string;
  created_at: number;
  statuses_count: number;
  followers_count: number;
  following_count: number;
  is_following: boolean;
  is_self: boolean;
}

export interface Status {
  id: string;
  type: string;
  body: string;
  media_path: string | null;
  created_at: number;
  account: Account | null;
  likes_count: number;
  shares_count: number;
  comments_count: number;
  liked: boolean;
  shared: boolean;
  repost_of_id: string | null;
  is_own: boolean;
}

export interface Paginated<T> {
  data: T[];
  pagination?: { next: string | null };
}

export interface Conversation {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  last_message: string | null;
  last_at: number | null;
  unread: number;
}

export interface DirectMessage {
  id: string;
  from_id: string;
  to_id: string;
  body: string;
  created_at: number;
  edited_at: number | null;
  key_for_sender: string | null;
  key_for_recipient: string | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  member_count: number;
  is_member: boolean;
}

export interface RoomChannel {
  id: string;
  name: string;
  type: string;
}

export interface RoomDetail {
  id: string;
  name: string;
  description: string;
  html: string;
  css: string;
  is_public: boolean;
  is_member: boolean;
  channels: RoomChannel[];
}

export interface RoomMessage {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  body: string;
  created_at: number;
  edited_at: number | null;
}

export interface MessagesResponse {
  messages: RoomMessage[];
  next: string | null;
}

export async function authLoginStart(): Promise<string> {
  return invoke<string>("auth_login_start");
}

export async function authLogout(): Promise<void> {
  return invoke<void>("auth_logout");
}

export async function authCurrentUser(): Promise<Account | null> {
  return invoke<Account | null>("auth_current_user");
}

export async function timelineHome(
  cursor?: string,
  limit?: number
): Promise<Paginated<Status>> {
  return invoke<Paginated<Status>>("timeline_home", { cursor, limit });
}

export async function createPost(body: string): Promise<Status> {
  return invoke<Status>("create_post", { body });
}

export async function likePost(id: string): Promise<Status> {
  return invoke<Status>("like_post", { id });
}

export async function unlikePost(id: string): Promise<Status> {
  return invoke<Status>("unlike_post", { id });
}

export async function reblogPost(id: string): Promise<Status> {
  return invoke<Status>("reblog_post", { id });
}

export async function userProfile(id: string): Promise<Account> {
  return invoke<Account>("user_profile", { id });
}

export async function userStatuses(
  id: string,
  cursor?: string,
  limit?: number
): Promise<Paginated<Status>> {
  return invoke<Paginated<Status>>("user_statuses", { id, cursor, limit });
}

export async function followUser(id: string): Promise<Account> {
  return invoke<Account>("follow_user", { id });
}

export async function unfollowUser(id: string): Promise<Account> {
  return invoke<Account>("unfollow_user", { id });
}

export async function conversationsList(): Promise<Conversation[]> {
  return invoke<Conversation[]>("conversations_list");
}

export async function conversationMessages(
  username: string,
  cursor?: string,
  limit?: number
): Promise<Paginated<DirectMessage>> {
  return invoke<Paginated<DirectMessage>>("conversation_messages", { username, cursor, limit });
}

export async function conversationSend(
  username: string,
  body: string
): Promise<DirectMessage> {
  return invoke<DirectMessage>("conversation_send", { username, body });
}

export async function roomsList(): Promise<RoomSummary[]> {
  return invoke<RoomSummary[]>("rooms_list");
}

export async function roomDetail(id: string): Promise<RoomDetail> {
  return invoke<RoomDetail>("room_detail", { id });
}

export async function roomMessages(
  roomId: string,
  channelId: string,
  cursor?: string
): Promise<MessagesResponse> {
  return invoke<MessagesResponse>("room_messages", { roomId, channelId, cursor });
}

export async function roomSendMessage(
  roomId: string,
  channelId: string,
  body: string
): Promise<void> {
  await invoke("room_send_message", { roomId, channelId, body });
}

export async function e2eeUnlock(password: string): Promise<void> {
  return invoke<void>("e2ee_unlock", { password });
}

export async function e2eeStatus(): Promise<boolean> {
  return invoke<boolean>("e2ee_status");
}

export async function fetchAvatar(path: string): Promise<string> {
  return invoke<string>("fetch_avatar", { path });
}

export async function fetchMedia(path: string): Promise<string> {
  return invoke<string>("fetch_media", { path });
}
