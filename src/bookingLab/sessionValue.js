// Booking item amounts already include the discount applied at checkout.
export function bookingItemValue(item) {
  const total = item.lineTotal ?? item.line_total;
  const amount = total ?? Number(item.unitAmount ?? item.unit_amount ?? 0) * Number(item.quantity ?? 1);
  return Math.max(0, Math.round(Number(amount) * 100) / 100);
}

export function bookedSessionValue(items, block, childCount = 1) {
  if (items.length) {
    return Math.round(items.reduce((sum, item) => sum + bookingItemValue(item), 0) * 100) / 100;
  }
  // Child-specific saved blocks must never be multiplied by the family size.
  const multiplier = block.childId || block.childName ? 1 : Math.max(1, Number(childCount));
  return Math.max(0, Math.round(Number(block.price || 0) * multiplier * 100) / 100);
}
