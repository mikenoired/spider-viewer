"use client";

import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { registerUser } from "@/lib/auth/auth.functions";
import type { RegisterInput } from "@/lib/auth/shared";
import { registerFieldsSchema, registerSchema } from "@/lib/auth/shared";

function toFieldErrors(errors: Array<unknown>) {
	return errors.flatMap((error) => {
		if (typeof error === "string") return [{ message: error }];

		if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
			return [{ message: error.message }];

		return [];
	});
}

export function RegisterForm() {
	const [submitError, setSubmitError] = useState<string | null>(null);
	const navigate = useNavigate();
	const form = useForm({
		defaultValues: {
			login: "",
			password: "",
			confirmPassword: "",
		} satisfies RegisterInput,
		validators: {
			onSubmit: registerSchema,
		},
		onSubmit: async ({ value }) => {
			setSubmitError(null);

			try {
				await registerUser({ data: value });
				toast.success("Заявка отправлена. После подтверждения суперпользователем вы сможете войти.");
				await navigate({ to: "/login" });
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Не удалось отправить заявку на регистрацию.";

				setSubmitError(message);
				toast.error(message);
			}
		},
	});

	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}>
			<FieldGroup>
				<form.Field name="login" validators={{ onBlur: registerFieldsSchema.shape.login }}>
					{(field) => {
						const errors = toFieldErrors(field.state.meta.errors);

						return (
							<Field data-invalid={errors.length > 0 || undefined}>
								<FieldLabel htmlFor={field.name}>Логин</FieldLabel>
								<Input
									id={field.name}
									name={field.name}
									autoComplete="username"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									aria-invalid={errors.length > 0}
								/>
								<FieldError errors={errors} />
							</Field>
						);
					}}
				</form.Field>
				<form.Field name="password" validators={{ onBlur: registerFieldsSchema.shape.password }}>
					{(field) => {
						const errors = toFieldErrors(field.state.meta.errors);

						return (
							<Field data-invalid={errors.length > 0 || undefined}>
								<FieldLabel htmlFor={field.name}>Пароль</FieldLabel>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="new-password"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									aria-invalid={errors.length > 0}
								/>
								<FieldError errors={errors} />
							</Field>
						);
					}}
				</form.Field>
				<form.Field
					name="confirmPassword"
					validators={{ onBlur: registerFieldsSchema.shape.confirmPassword }}>
					{(field) => {
						const errors = toFieldErrors(field.state.meta.errors);

						return (
							<Field data-invalid={errors.length > 0 || undefined}>
								<FieldLabel htmlFor={field.name}>Повторите пароль</FieldLabel>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									autoComplete="new-password"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									aria-invalid={errors.length > 0}
								/>
								<FieldError errors={errors} />
							</Field>
						);
					}}
				</form.Field>
			</FieldGroup>
			{submitError ? <FieldError>{submitError}</FieldError> : null}
			<form.Subscribe
				selector={(state) => ({
					canSubmit: state.canSubmit,
					isSubmitting: state.isSubmitting,
				})}>
				{({ canSubmit, isSubmitting }) => (
					<div className="flex flex-col gap-3">
						<Button type="submit" disabled={!canSubmit || isSubmitting}>
							{isSubmitting ? <Spinner data-icon="inline-start" /> : null}
							Отправить заявку
						</Button>
						<Button asChild variant="outline">
							<Link to="/login">Назад ко входу</Link>
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
