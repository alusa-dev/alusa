import { redirect } from "next/navigation";

export default function LancamentosRedirect() {
  redirect("/financeiro/extrato");
}
