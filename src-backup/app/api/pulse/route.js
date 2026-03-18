import { NextResponse } from "next/server";

// Placeholder poll data - in production this would come from a sheet
export async function GET() {
  const poll = {
    id: "pulse_" + new Date().toISOString().split("T")[0],
    question: "Best day of the week?",
    options: ["Friday", "Saturday", "Sunday"],
    counts: [5, 2, 1],
  };

  return NextResponse.json({ success: true, poll });
}