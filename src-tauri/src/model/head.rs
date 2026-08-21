use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Whether HEAD points at a branch or is detached.
///
/// タグのチェックアウトが v1 に入っているので detached は必ず起きる
/// (docs/specs/data-model.md)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
// 値はデータモデルの表どおり `"branch" | "detached"`。
// フィールド名ではなく列挙子なので rename_all を使う (docs/adr/0013-type-generation.md)
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HeadKind {
    Branch,
    Detached,
}

/// State of HEAD in the registered worktree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Head {
    pub kind: HeadKind,
    /// Branch name, or the reference HEAD is detached at (a tag or a short hash).
    pub name: String,
}

impl Head {
    pub fn branch(name: impl Into<String>) -> Self {
        Self {
            kind: HeadKind::Branch,
            name: name.into(),
        }
    }

    pub fn detached(name: impl Into<String>) -> Self {
        Self {
            kind: HeadKind::Detached,
            name: name.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&Head::branch("main"));
    }

    /// `kind` は小文字の 2 値。TypeScript の型と実行時の値がずれると
    /// フロントの分岐が黙って全部 false になる。
    #[test]
    fn serializes_the_kind_in_lower_case() {
        assert_eq!(
            serde_json::to_value(Head::branch("main")).expect("Head should serialize"),
            serde_json::json!({ "kind": "branch", "name": "main" })
        );
        assert_eq!(
            serde_json::to_value(Head::detached("v1.0.0")).expect("Head should serialize"),
            serde_json::json!({ "kind": "detached", "name": "v1.0.0" })
        );
    }

    /// 生成した TypeScript も同じ 2 値を宣言している
    #[test]
    fn ts_declaration_lists_both_kinds() {
        let declaration = <HeadKind as ts_rs::TS>::decl(&ts_rs::Config::default());

        assert!(declaration.contains("\"branch\""), "{declaration}");
        assert!(declaration.contains("\"detached\""), "{declaration}");
    }
}
