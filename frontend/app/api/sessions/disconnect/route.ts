import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

export async function POST(req: Request) {

    const { sessionId } = await req.json();

    const res = await fetch(`${API}/sessions/disconnect`, {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify({

            sessionId

        })

    });

    const data = await res.json();

    return NextResponse.json(data);

}