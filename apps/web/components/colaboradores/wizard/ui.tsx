"use client";
import * as React from "react";
import { useFormContext } from "react-hook-form";
export { StepHeader, SectionCard, FieldLabel, FieldError, IMaskControlled, DateMaskControlled } from "../../alunos/wizard/ui";

// Campo monetário: mantém número no formulário (centavos -> número com 2 casas)
export function MoneyMaskControlled({
	name,
	id,
	ariaLabel = "Valor",
	placeholder = "0,00",
	inputClassName,
}: {
	name: string;
	id?: string;
	ariaLabel?: string;
	placeholder?: string;
	inputClassName?: string;
}) {
	const ctx = useFormContext() as unknown as {
		watch: (_: string) => unknown;
		setValue: (_: string, _v: unknown, _o?: unknown) => void;
	};
	const raw = ctx.watch(name) as unknown;
	const typingRef = React.useRef(false);

	// Helpers BRL: últimos dois dígitos são centavos
		function formatBRL(value: string): string {
			const digits = value.replace(/\D/g, "");
			if (!digits) return "";
			const padded = digits.padStart(3, "0");
			let intPart = padded.slice(0, -2);
			const decPart = padded.slice(-2);
			// remove zeros à esquerda da parte inteira, mas mantém "0" se vazio
			intPart = intPart.replace(/^0+(?!$)/, "");
			const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
			return `${intFormatted},${decPart}`;
		}

	function parseBRL(display: string): number | undefined {
		if (!display) return undefined;
		const normalized = display.replace(/\./g, "").replace(",", ".");
		const num = parseFloat(normalized);
		return isNaN(num) ? undefined : num;
	}

	// estado de exibição; inicia com número vindo do form (quando houver)
		const [display, setDisplay] = React.useState<string>(
			typeof raw === "number" && !Number.isNaN(raw)
				? formatBRL(String(Math.round(raw * 100)))
				: ""
		);

	React.useEffect(() => {
			if (typingRef.current) return; // não sobrescrever enquanto digitando
			if (typeof raw === "number" && !Number.isNaN(raw)) {
				setDisplay(formatBRL(String(Math.round(raw * 100))));
			}
	}, [raw]);

	function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
			typingRef.current = true;
			const input = e.target.value ?? "";
			const nextDisplay = formatBRL(input);
		setDisplay(nextDisplay);

			const numeric = parseBRL(nextDisplay);
		ctx.setValue(name, numeric, { shouldValidate: false });
	}

	function handleBlur() {
			typingRef.current = false;
		if (!display) return;
			const numeric = parseBRL(display);
		if (numeric === undefined) return;
			// força sempre exibir duas casas (normaliza a partir de centavos)
			setDisplay(formatBRL(String(Math.round(numeric * 100))));
	}

	return (
		<input
			type="text"
			inputMode="decimal"
			value={display}
			onChange={handleChange}
			onBlur={handleBlur}
			className={`flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white focus-visible:outline-none focus-visible:ring-0 ${inputClassName ?? ""}`}
			placeholder={placeholder}
			aria-label={ariaLabel}
			id={id}
		/>
	);
}
