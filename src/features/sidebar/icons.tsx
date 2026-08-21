/*
 * サイドバーのアイコン。形はモック (docs/mock/tree.tmpl.html の `.strip`) と同じパス。
 * 寸法と色は Sidebar.module.css。
 */

export function NewBranch() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function DeleteBranch() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 4.8h9M6.2 4.8V3.2h3.6v1.6M5.2 4.8 6 13h4l.8-8.2" />
    </svg>
  );
}

export function Fetch() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 3.5 5.6 10.9" strokeDasharray="2.4 1.9" />
      <path d="M5.6 7.1v3.8h3.8" />
    </svg>
  );
}

export function Pull() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 3.5 5.6 10.9" />
      <path d="M5.6 7.1v3.8h3.8" />
    </svg>
  );
}

export function ExpandLocal() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.4 4.6 8 8.2l3.6-3.6" />
      <path d="M4.6 12h6.8" />
    </svg>
  );
}

export function ExpandAll() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.4 6.6 8 3l3.6 3.6" />
      <path d="M4.4 9.4 8 13l3.6-3.6" />
    </svg>
  );
}

export function CollapseAll() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.4 3.4 8 7l3.6-3.6" />
      <path d="M4.4 12.6 8 9l3.6 3.6" />
    </svg>
  );
}

export function Group() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 12.6V3.4h4l1.4 2H14v7.2z" />
      <path d="M5.6 7.4v3.4M5.6 8.6h2.6M5.6 10.6h2.6" />
    </svg>
  );
}

export function LocalOnly() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.8 3.8h10.4v6.4H2.8z" />
      <path d="M1.4 12.4h13.2" />
    </svg>
  );
}

export function AddRepo() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 12.6V3.4h4l1.4 2H14v7.2z" />
      <path d="M8 7.6v3.4M6.3 9.3h3.4" />
    </svg>
  );
}

export function RemoveRepo() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 12.6V3.4h4l1.4 2H14v7.2z" />
      <path d="M6.3 9.3h3.4" />
    </svg>
  );
}

export function Console() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.2 3h11.6v10H2.2z" />
      <path d="M4.6 6.6 6.4 8.2 4.6 9.8M8.2 10h3" />
    </svg>
  );
}
