// Held for the entire quit barrier, including asynchronous connector cleanup.
// Refused quit reopens admission after every owned cleanup attempt settles.
let closing = false;
export function setWorkspaceRuntimeClosing(value: boolean): void { closing = value; }
export function assertWorkspaceRuntimeOpen(): void {
  if (closing) throw new Error('HomeBot is closing. New terminals, tasks, debugger sessions and test runs are paused until closing finishes.');
}
