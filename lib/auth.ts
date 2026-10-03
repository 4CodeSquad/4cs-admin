import "server-only";
import { db } from "@/db";
import { createAuth } from "./auth-config";

export const auth = createAuth(db);
