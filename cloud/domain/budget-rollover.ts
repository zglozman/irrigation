// Shared weekly-budget rollover: resets both delivered and rainfall totals
// when the tracked week is more than 7 days old.

export interface RolledBudget {
  deliveredGal: number;
  rainfallGal: number;
  weekStart: string;
}

export function rolloverBudgetIfNeeded(
  budget: { week_start_date: string; delivered_gal_this_week: number; rainfall_gal_this_week: number },
  now: Date
): RolledBudget {
  const weekStart = new Date(budget.week_start_date);
  const daysOld = Math.floor((now.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));

  if (daysOld > 7) {
    return {
      deliveredGal: 0,
      rainfallGal: 0,
      weekStart: now.toISOString().split("T")[0],
    };
  }

  return {
    deliveredGal: budget.delivered_gal_this_week,
    rainfallGal: budget.rainfall_gal_this_week,
    weekStart: budget.week_start_date,
  };
}
