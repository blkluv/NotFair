/**
 * Chat layout: escape the parent main's p-6 padding so the conversation can
 * fill the entire content area edge-to-edge. Sticky composer + scrollable
 * thread need a single flex column that owns the viewport region.
 *
 * Parent main has `relative p-6`; this absolute child fills the padding box
 * (i.e., the main element's full inner area, ignoring the padding inset).
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex flex-col">{children}</div>;
}
