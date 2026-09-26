// Shared between the Assistant tab (src/app/(home)/assistant.tsx) and the
// full-screen chat it opens (src/app/chat.tsx).
//
// The Assistant tab is only a doorway: focusing it opens the chat page on top
// of the tabs. Closing the chat (back arrow, Android back button, iOS swipe)
// pops it, which lands back on the Assistant tab — which would open the chat
// again. The chat sets `returning` as it closes so the doorway can tell "the
// user just left the chat" from "the user tapped the tab", and send them Home.
export const assistantNav = { returning: false };
