pub mod google;
pub mod mymemory;
pub mod openai;

use std::time::Duration;

pub(crate) fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("scholarust/0.1")
        .build()
        .expect("failed to build HTTP client")
}