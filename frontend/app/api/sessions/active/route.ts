import { NextRequest, NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(`${API}/sessions/active`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

console.log("=================================");
console.log("STATUS:", res.status);
console.log("CONTENT-TYPE:", res.headers.get("content-type"));
console.log("BODY:");
console.log(text);
console.log("=================================");

return new NextResponse(text, {
  status: res.status,
  headers: {
    "Content-Type": res.headers.get("content-type") || "text/plain",
  },
});

  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message,
      },
      {
        status: 500,
      }
    );
  }
}