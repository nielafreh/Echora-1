import express from "express";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

const app = express();
const PORT = 3000;

/* =========================================================
   CONFIG
   ========================================================= */

const PLAN_CONFIG = {
  monthly: {
    amount: 500,
    priceId: "price_1Ub56LRzCXUCCVE5q0vLY7NP",
    label: "Abbonamento Mensile",
    description: "5,00 €/mese",
  },
  annual: {
    amount: 5000,
    priceId: "price_1Ub55uRzCXUCCVE5G7yIAMsX",
    label: "Abbonamento Annuale",
    description: "50,00 €/anno",
  },
} as const;

type PaidPlan = keyof typeof PLAN_CONFIG;

/* =========================================================
   STRIPE WEBHOOK RAW BODY
   Deve essere prima di express.json()
   ========================================================= */

app.use(
  "/api/webhook",
  express.raw({
    type: "*/*",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

/* =========================================================
   STANDARD JSON & STATIC AUDIO
   ========================================================= */

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use(
  "/audio",
  express.static(path.join(process.cwd(), "public", "audio"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".mp3")) {
        res.setHeader("Content-Type", "audio/mpeg");
      } else if (filePath.endsWith(".webm")) {
        res.setHeader("Content-Type", "audio/webm");
      } else if (filePath.endsWith(".ogg")) {
        res.setHeader("Content-Type", "audio/ogg");
      } else if (filePath.endsWith(".wav")) {
        res.setHeader("Content-Type", "audio/wav");
      } else if (filePath.endsWith(".m4a") || filePath.endsWith(".mp4")) {
        res.setHeader("Content-Type", "audio/mp4");
      }
      res.setHeader("Accept-Ranges", "bytes");
    },
  }),
  // Prevent missing audio files from falling through to Vite SPA index.html
  (_req, res) => {
    res.status(404).type("application/json").json({ error: "Audio demo non trovato." });
  }
);

/* =========================================================
   STRIPE CLIENT
   ========================================================= */

function getStripe(): Stripe | null {
  let secretKey = (
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET ||
    process.env.STRIPE_KEY ||
    process.env.VITE_STRIPE_SECRET_KEY
  )?.trim();

  if (secretKey) {
    if (
