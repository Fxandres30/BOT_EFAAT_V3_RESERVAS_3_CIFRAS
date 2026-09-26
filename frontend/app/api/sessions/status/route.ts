import { NextResponse } from "next/server";
import { botApiHeaders } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");

    const res = await fetch(`${API}/sessions/status/${id}`, {
        headers: botApiHeaders()
    });

    const data = await res.json();

    return NextResponse.json(data);

}