import { NextRequest, NextResponse } from "next/server";
import { isDevMode } from "@/lib/app-mode";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { acceptInvitation, findPendingInvitation } from "@/lib/workspace/invitations";
import { createUserWithPassword, findUserByEmail } from "@/lib/auth/users";

interface OtpEntry {
  code: string;
  expires: number;
}

// Development-safe in-memory store that persists across hot reloads in Next.js dev server
const globalStore = globalThis as any;
globalStore.signupOtpStore = globalStore.signupOtpStore || new Map<string, OtpEntry>();
const signupOtpStore: Map<string, OtpEntry> = globalStore.signupOtpStore;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (action === "send") {
      // 1. Already registered?
      if (await findUserByEmail(email)) {
        return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
      }

      // 3. Generate 6-digit OTP code
      const code = crypto.randomInt(100000, 999999).toString();

      // 4. Save code in store (10 minutes validity)
      signupOtpStore.set(email, {
        code,
        expires: Date.now() + 10 * 60 * 1000,
      });

      // 5. Prepare SMTP Configuration
      const cleanEnv = (val: string | undefined): string => {
        if (!val) return "";
        return val.replace(/^["']|["']$/g, "");
      };

      const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
      const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
      const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
      const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
      const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);
      const smtpFrom = cleanEnv(process.env.SMTP_FROM) || smtpUser || "chatnexgenai@gmail.com";

      // Developer Fallback: Log the verification code to the console
      if (isDevMode()) console.log(`\n--- [SIGNUP OTP] Verification code for ${email} is: ${code} ---\n`);

      if (smtpHost && smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        const formattedFrom = smtpFrom.includes("<") ? smtpFrom : `Whasalia <${smtpFrom}>`;
        const mailOptions = {
          from: formattedFrom,
          to: email,
          subject: "Email Verification Code for Registration",
          text: `Your 6-digit verification code is: ${code}. It is valid for 10 minutes.`,
          html: `
            <div style="background-color: #f8fafc; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-height: 100%;">
              <div style="max-width: 460px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 24px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
                <div style="margin-bottom: 24px;">
                  <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Chat<span style="color: #10b981;">NexGen</span></span>
                </div>
                
                <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">Email Verification</h2>
                
                <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 0; margin-bottom: 24px;">
                  Thank you for registering. Use the verification code below to complete your registration:
                </p>
                
                <div style="font-size: 36px; font-weight: 800; font-family: 'Courier New', Courier, monospace; background-color: #f8fafc; padding: 14px 28px; border-radius: 12px; display: inline-block; letter-spacing: 8px; margin-bottom: 24px; color: #0f172a; border: 1px solid #e2e8f0; text-indent: 8px;">
                  ${code}
                </div>
                
                <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                  This code will expire in 10 minutes.<br>If you did not make this request, you can safely ignore this email.
                </p>
              </div>
            </div>
          `,
        };

        try {
          await transporter.sendMail(mailOptions);
        } catch (mailErr: any) {
          console.error("Failed to send SMTP registration email:", mailErr);
          // In development mode, don't block the user if SMTP fails (since code is printed in terminal)
          if (isDevMode()) {
            return NextResponse.json({
              success: true,
              devCode: code,
              note: "SMTP sending failed, but OTP logged in terminal for development.",
            });
          }
          return NextResponse.json(
            { error: `Failed to send email: ${mailErr.message || mailErr}` },
            { status: 500 }
          );
        }
      } else {
        // If SMTP credentials aren't configured, let development environment succeed using logged OTP
        if (!isDevMode()) {
          return NextResponse.json({ error: "SMTP is not configured on the server." }, { status: 500 });
        }
      }

      return NextResponse.json(isDevMode() ? { success: true, devCode: code } : { success: true });
    }

    if (action === "register") {
      const { code, fullName, password, businessName, businessType, country, currency, timezone, locale, invite } = body;

      // Invited users join an existing workspace and skip business details.
      const invitation = invite ? await findPendingInvitation(String(invite)) : null;
      if (invite && (!invitation || invitation.email.toLowerCase() !== String(email).toLowerCase())) {
        return NextResponse.json({ error: "Invitation not found or expired" }, { status: 400 });
      }

      if (!code || !fullName || !password || (!invitation && (!businessName || !businessType))) {
        return NextResponse.json({ error: "Missing required registration parameters" }, { status: 400 });
      }

      // 1. Verify OTP code
      const stored = signupOtpStore.get(email);
      if (!stored) {
        return NextResponse.json(
          { error: "Verification code not found or expired. Please request a new one." },
          { status: 400 }
        );
      }

      if (stored.expires < Date.now()) {
        signupOtpStore.delete(email);
        return NextResponse.json(
          { error: "Verification code expired. Please request a new one." },
          { status: 400 }
        );
      }

      if (stored.code !== code) {
        return NextResponse.json({ error: "Invalid verification code. Please try again." }, { status: 400 });
      }

      // 2. Double-check the email is still free (prevents races)
      if (await findUserByEmail(email)) {
        signupOtpStore.delete(email);
        return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
      }

      // 3. Create the user (email already verified by the code)
      let newUser: { id: string; email: string };
      try {
        newUser = await createUserWithPassword({
        email,
        password,
        emailVerified: true,
        // handle_new_user() (migration 021) creates the profile and, unless
        // `invite` is set, the workspace with this user as owner.
        meta: invitation
          ? { full_name: fullName, invite: true, locale }
          : {
              full_name: fullName,
              business_name: businessName,
              business_type: businessType,
              country,
              currency,
              timezone,
              locale,
            },
        });
      } catch (createErr) {
        console.error("User creation failed:", createErr);
        return NextResponse.json(
          { error: `Registration failed: ${createErr instanceof Error ? createErr.message : String(createErr)}` },
          { status: 500 }
        );
      }

      if (invitation) {
        await acceptInvitation(invitation, newUser.id);
      }

      // 4. Clear the OTP code
      signupOtpStore.delete(email);

      return NextResponse.json({ success: true, user: { id: newUser.id, email: newUser.email } });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("Signup OTP route error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
