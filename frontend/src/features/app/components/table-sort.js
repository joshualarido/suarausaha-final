export function nextSortState(currentSort, sortBy, defaultDirection = "desc") {
  if (currentSort.sortBy !== sortBy) {
    return { sortBy, sortDirection: defaultDirection };
  }

  return {
    sortBy,
    sortDirection: currentSort.sortDirection === "asc" ? "desc" : "asc",
  };
}

export function compareValues(left, right, direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;
  const leftValue = left ?? "";
  const rightValue = right ?? "";

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }

  return String(leftValue).localeCompare(String(rightValue), "id-ID", { numeric: true }) * multiplier;
}

export function sortRows(rows, sortBy, direction, getters) {
  const getValue = getters[sortBy];
  if (!getValue) return rows;

  return [...rows].sort((left, right) => compareValues(getValue(left), getValue(right), direction));
}
