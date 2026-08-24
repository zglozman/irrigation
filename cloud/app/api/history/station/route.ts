// GET /api/history/station - Station weather history
// Query params:
//   ?year=YYYY - get year summary + daily records
//   ?date=YYYY-MM-DD - get hourly data for one day
//   (no params) - get available years + current year history

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getYearHistory, getDayDetail, getAvailableYears } from "@/lib/station-history";

// Validate year: 2015-2100
function isValidYear(year: string): boolean {
  const y = Number(year);
  return Number.isInteger(y) && y >= 2015 && y <= 2100;
}

// Validate date: YYYY-MM-DD
function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const dateParam = searchParams.get("date");

    // Case 1: Get year summary
    if (yearParam) {
      if (!isValidYear(yearParam)) {
        return NextResponse.json(
          { error: "Invalid year format. Expected YYYY between 2015 and 2100" },
          { status: 400 }
        );
      }
      const yearHistory = await getYearHistory(Number(yearParam));
      return NextResponse.json(yearHistory);
    }

    // Case 2: Get day detail
    if (dateParam) {
      if (!isValidDate(dateParam)) {
        return NextResponse.json(
          { error: "Invalid date format. Expected YYYY-MM-DD" },
          { status: 400 }
        );
      }
      const hours = await getDayDetail(dateParam);
      return NextResponse.json({ date: dateParam, hours });
    }

    // Case 3: Get available years + current year
    const years = await getAvailableYears();
    const currentYear = new Date().getUTCFullYear();
    const currentYearHistory = await getYearHistory(currentYear);

    return NextResponse.json({
      available_years: years,
      current_year_history: currentYearHistory,
    });
  } catch (error) {
    console.error("[History/Station] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
