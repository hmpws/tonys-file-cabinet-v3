import { createCookieSessionStorage, redirect } from "react-router";

type UserSession = {
    userId: string;
};

const storage = createCookieSessionStorage({
    cookie: {
        name: "tonys_file_cabinet_session",
        secure: process.env.NODE_ENV === "production",
        secrets: ["s3cr3t_should_be_in_env"], // In prod, put this in .env
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        httpOnly: true,
    },
});

export const { getSession, commitSession, destroySession } = storage;

export async function createUserSession(userId: string, redirectTo: string) {
    const session = await getSession();
    session.set("userId", userId);
    return redirect(redirectTo, {
        headers: {
            "Set-Cookie": await commitSession(session),
        },
    });
}

export async function getUser(request: Request): Promise<string | null> {
    const session = await getSession(request.headers.get("Cookie"));
    const userId = session.get("userId");
    if (!userId || typeof userId !== "string") return null;
    return userId;
}

export async function requireUser(request: Request) {
    const userId = await getUser(request);
    if (!userId) {
        throw redirect("/login");
    }
    return userId;
}

export async function logout(request: Request) {
    const session = await getSession(request.headers.get("Cookie"));
    return redirect("/login", {
        headers: {
            "Set-Cookie": await destroySession(session),
        },
    });
}
