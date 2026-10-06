type Session = { owner: object; stop: () => void };
let current: Session | undefined;

/** One logical Studio transport, including silent previews with no decoder. */
export function acquireStudioPlayback(owner: object, stop: () => void): void {
  if (current?.owner === owner) { current.stop = stop; return; }
  const previous = current;
  current = { owner, stop };
  previous?.stop();
}

export function releaseStudioPlayback(owner: object): void {
  if (current?.owner === owner) current = undefined;
}
