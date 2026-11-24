/** React Router v7 behaviours, decided explicitly for every router in the app and the tests
 * (which also silences the future-flag warnings).
 * - v7_relativeSplatPath: on; no route resolves relative links inside a splat route.
 * - v7_startTransition: off. With it, navigation after deleting a repository, a conversation
 *   or the account runs in a transition, and the page being left refetches what was just
 *   deleted (the delete-flow tests catch it). It stays off until that is solved. */
export const ROUTER_FUTURE = { v7_startTransition: false, v7_relativeSplatPath: true } as const
