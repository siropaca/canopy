use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A remote-tracking branch or a tag.
///
/// 名前は短縮形 (`origin/develop`)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Ref {
    pub name: String,
    /// Unix milliseconds of the commit (or of the tag object, for annotated tags).
    pub committed_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&Ref {
            name: "origin/develop".to_owned(),
            committed_at: 1_755_000_000_000,
        });
    }
}
