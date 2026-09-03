import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {

        const { sessionId } = await req.json();

        const BOT_API_URL = process.env.BOT_API_URL;

        if (!BOT_API_URL) {
            return NextResponse.json(
                {
                    success: false,
                    message: "BOT_API_URL no está configurada."
                },
                {
                    status: 500
                }
            );
        }

        const res = await fetch(`${BOT_API_URL}/sessions/connect`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sessionId
            })
        });

        const text = await res.text();

        if (!res.ok) {
            return NextResponse.json(
                {
                    success: false,
                    message: text || "Error al conectar con el bot."
                },
                {
                    status: res.status
                }
            );
        }

        const data = text ? JSON.parse(text) : {};

        return NextResponse.json(data);

    } catch (error: any) {

        console.error(error);

        return NextResponse.json(
            {
                success: false,
                message: error.message || "Error interno del servidor."
            },
            {
                status: 500
            }
        );
    }
}