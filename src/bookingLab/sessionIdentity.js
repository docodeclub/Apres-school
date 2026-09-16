// A child-session, rather than a time slot, is the unit of cancellation.
export function bookingBlockIdentity(block) {
  return [block?.label, block?.start, block?.end,
    block?.childId || block?.child_id || block?.childName || block?.child_name]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

export function cancellationMatchesBlock(cancellation, block) {
  const key = bookingBlockIdentity(block);
  // Older saved sessionKey values omitted the child. Rebuild from their blocks.
  return cancellation.blocks?.length
    ? cancellation.blocks.some((saved) => bookingBlockIdentity(saved) === key)
    : cancellation.sessionKey === key;
}
