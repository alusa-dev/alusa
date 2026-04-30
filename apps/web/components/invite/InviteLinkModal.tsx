"use client";

import React from "react";
import dynamic from "next/dynamic";
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icons/Icon";
import { motion, AnimatePresence } from "framer-motion";

export type InviteLinkModalProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  inviteUrl: string | null;
  email?: string;
  expiresInHours?: number;
};

export function InviteLinkModal({
  open,
  onOpenChange,
  inviteUrl,
  email,
  expiresInHours = 72,
}: InviteLinkModalProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [copied, setCopied] = React.useState(false);
  const hasUrl = Boolean(inviteUrl);

  // Copiar
  const onCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
        document.execCommand?.("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  // Compartilhar
  const onShare = async () => {
    if (!inviteUrl) return;
    const nav = navigator as Navigator & {
      share?: (_data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (!nav.share) return;
    try {
      await nav.share({
        title: "Convite Alusa",
        text: "Acesse seu convite:",
        url: inviteUrl,
      });
    } catch {
      /* cancelado */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-lg font-semibold">
                  Convite criado
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Envie o link abaixo para{" "}
                  {email ? (
                    <strong className="font-semibold text-foreground">{email}</strong>
                  ) : (
                    "o convidado"
                  )}
                  . Este convite expira em {expiresInHours} horas.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-6 py-4">
                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    {hasUrl ? (
                      <QRCode value={inviteUrl!} size={192} />
                    ) : (
                      <div className="h-[192px] w-[192px] grid place-items-center text-sm text-muted-foreground">
                        Gerando link…
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Escaneie o QR Code ou use o link.
                </p>

                {/* Input + copiar + compartilhar */}
                <div className="flex w-full items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={inputRef}
                      aria-label="link de convite"
                      readOnly
                      value={inviteUrl ?? ""}
                      placeholder={hasUrl ? undefined : ""}
                      className="pr-10 text-sm bg-[#F8F9FB] border-none shadow-none text-foreground placeholder:text-gray-500"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={onCopy}
                      disabled={!hasUrl}
                      aria-label="Copiar link"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-[#43474A] hover:text-black"
                    >
                      {copied ? (
                        <Icon name="CheckCircle" className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Icon name="Copy" className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <Button
                      type="button"
                      variant="default"
                      onClick={onShare}
                      disabled={!hasUrl}
                      aria-label="Compartilhar link"
                      size="sm"
                      className="gap-2 bg-blue-600 hover:bg-blue-600/90 text-white focus-visible:ring-blue-600/50"
                    >
                      <Icon name="Share2" className="h-4 w-4" />
                      Compartilhar
                    </Button>
                  )}
                </div>

                <span aria-live="polite" className="sr-only">
                  {copied ? "Link copiado para a área de transferência" : ""}
                </span>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Por segurança, não compartilhe publicamente. O convite é pessoal e
                  vinculado ao e-mail.
                </p>
              </div>

              <DialogFooter className="flex flex-col sm:flex-row sm:justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    requestAnimationFrame(() => {
                      const el = document.getElementById(
                        "invite-email"
                      ) as HTMLInputElement | null;
                      el?.focus();
                    });
                  }}
                  aria-label="fechar e enviar outro"
                  size="sm"
                  className="border border-gray-300 shadow-none"
                >
                  Fechar e enviar outro
                </Button>

                <Button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="fechar modal"
                  variant="destructive"
                  size="sm"
                  className="bg-red-600 hover:bg-red-600/90 text-white focus-visible:ring-red-600/50"
                >
                  Fechar
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

export default InviteLinkModal;
