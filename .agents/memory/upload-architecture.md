---
name: Upload architecture
description: How file uploads flow through the KPR OM Database app — Header button, global queue, drag handling.
---

Upload OMs button lives in **Header.tsx** (green split button). Header accepts an `onFiles: (fl: FileList) => void` prop.

App.tsx manages:
- `pendingFiles: File[]` state — set by Header callback or drag-drop
- Root-level drag handlers (onDragEnter/Over/Leave/Drop) with a full-screen overlay
- UploadQueue rendered globally outside any tab (after the tab content) so uploads persist across tab switches

UploadQueue.tsx:
- Receives `pendingFiles` + `onFilesConsumed` (called to clear after processing starts)
- No inline drop zone — drag is handled at App level
- Shows as a fixed-bottom panel when queue has items, with `queueOpen` toggle
- Per-item progress bars (0-100%) with status messages
- Aggregate progress bar across all items
- "Retry failed", "Clear completed", "View" (navigates to deal detail), "Hide" buttons
- Floating pill shown when panel hidden but items still processing

**Why:** Matches the original om-database.jsx design where the upload button is in the header and the queue is a fixed bottom drawer, not inline in a page section. Also allows uploads from any tab (Analyst or Portfolio).
