import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { slugify } from "@/lib/slug";
import { api } from "@/utils/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { Github, HelpCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const GitHubImportSchema = z.object({
	githubUrl: z
		.string()
		.min(1, { message: "GitHub URL is required" })
		.url({ message: "Please enter a valid URL" })
		.refine(
			(url) => {
				try {
					const urlObj = new URL(url);
					return urlObj.hostname === "github.com";
				} catch {
					return false;
				}
			},
			{ message: "URL must be a valid GitHub repository URL" },
		),
	customName: z.string().optional(),
	branch: z.string().optional(),
	accessToken: z.string().optional(),
	serverId: z.string().optional(),
});

type GitHubImport = z.infer<typeof GitHubImportSchema>;

interface Props {
	projectId: string;
	projectName?: string;
}

export const GitHubImport = ({ projectId, projectName }: Props) => {
	const utils = api.useUtils();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const [visible, setVisible] = useState(false);
	const [isValidating, setIsValidating] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const slug = slugify(projectName);
	const { data: servers } = api.server.withSSHKey.useQuery();

	const { mutateAsync: validateRepo } =
		api.project.validateGithubRepository.useMutation();
	const {
		mutateAsync: ingestFromGithub,
		isLoading,
		error,
		isError,
	} = api.project.ingestFromGithub.useMutation();

	const form = useForm<GitHubImport>({
		defaultValues: {
			githubUrl: "",
			customName: "",
			branch: "",
			accessToken: "",
		},
		resolver: zodResolver(GitHubImportSchema),
	});

	const githubUrl = form.watch("githubUrl");

	const validateRepository = async () => {
		if (!githubUrl) return;

		setIsValidating(true);
		setValidationError(null);

		try {
			const result = await validateRepo({
				githubUrl,
				accessToken: form.getValues("accessToken"),
			});

			if (!result.isValid) {
				setValidationError("Repository not found or not accessible");
			} else {
				toast.success("Repository validation successful");
			}
		} catch (error) {
			setValidationError(
				error instanceof Error
					? error.message
					: "Failed to validate repository",
			);
		} finally {
			setIsValidating(false);
		}
	};

	const onSubmit = async (data: GitHubImport) => {
		try {
			await ingestFromGithub({
				githubUrl: data.githubUrl,
				projectId,
				customName: data.customName,
				branch: data.branch,
				accessToken: data.accessToken,
			});

			toast.success("GitHub project import initiated successfully");
			form.reset();
			setVisible(false);
			setValidationError(null);

			await utils.project.one.invalidate({ projectId });
			await utils.project.listDeployedProjects.invalidate();
		} catch (error) {
			toast.error("Error importing GitHub project");
		}
	};

	return (
		<Dialog open={visible} onOpenChange={setVisible}>
			<DialogTrigger className="w-full">
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3"
					onSelect={(e) => e.preventDefault()}
				>
					<Github className="size-4 text-muted-foreground" />
					<span>Import from GitHub</span>
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Import from GitHub</DialogTitle>
					<DialogDescription>
						Import and deploy a project directly from a GitHub repository
					</DialogDescription>
				</DialogHeader>

				{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}
				{validationError && (
					<AlertBlock type="error">{validationError}</AlertBlock>
				)}

				<Form {...form}>
					<form
						id="github-import-form"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-4"
					>
						<FormField
							control={form.control}
							name="githubUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>GitHub Repository URL</FormLabel>
									<FormControl>
										<div className="flex space-x-2">
											<Input
												placeholder="https://github.com/username/repo"
												{...field}
												onChange={(e) => {
													field.onChange(e);
													setValidationError(null);
												}}
											/>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={validateRepository}
												disabled={!githubUrl || isValidating}
											>
												{isValidating ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													"Validate"
												)}
											</Button>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="customName"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Custom Name (Optional)</FormLabel>
									<FormControl>
										<Input
											placeholder="Leave empty to use repository name"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="branch"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Branch (Optional)</FormLabel>
									<FormControl>
										<Input placeholder="main (default)" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="accessToken"
							render={({ field }) => (
								<FormItem>
									<TooltipProvider delayDuration={0}>
										<Tooltip>
											<TooltipTrigger asChild>
												<FormLabel className="break-all w-fit flex flex-row gap-1 items-center">
													GitHub Access Token (Optional)
													<HelpCircle className="size-4 text-muted-foreground" />
												</FormLabel>
											</TooltipTrigger>
											<TooltipContent
												className="z-[999] w-[300px]"
												align="start"
												side="top"
											>
												<span>
													Required for private repositories. Generate a personal
													access token from GitHub Settings → Developer settings
													→ Personal access tokens. Only needed for repository
													access.
												</span>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
									<FormControl>
										<Input
											type="password"
											placeholder="ghp_xxxxxxxxxxxx"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="serverId"
							render={({ field }) => (
								<FormItem>
									<TooltipProvider delayDuration={0}>
										<Tooltip>
											<TooltipTrigger asChild>
												<FormLabel className="break-all w-fit flex flex-row gap-1 items-center">
													Select a Server {!isCloud ? "(Optional)" : ""}
													<HelpCircle className="size-4 text-muted-foreground" />
												</FormLabel>
											</TooltipTrigger>
											<TooltipContent
												className="z-[999] w-[300px]"
												align="start"
												side="top"
											>
												<span>
													If no server is selected, the application will be
													deployed on the server where the user is logged in.
												</span>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>

									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
									>
										<SelectTrigger>
											<SelectValue placeholder="Select a Server" />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{servers?.map((server) => (
													<SelectItem
														key={server.serverId}
														value={server.serverId}
													>
														<span className="flex items-center gap-2 justify-between w-full">
															<span>{server.name}</span>
															<span className="text-muted-foreground text-xs self-center">
																{server.ipAddress}
															</span>
														</span>
													</SelectItem>
												))}
												<SelectLabel>Servers ({servers?.length})</SelectLabel>
											</SelectGroup>
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
					</form>

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setVisible(false);
								form.reset();
								setValidationError(null);
							}}
						>
							Cancel
						</Button>
						<Button
							isLoading={isLoading}
							form="github-import-form"
							type="submit"
							disabled={!!validationError}
						>
							Import & Deploy
						</Button>
					</DialogFooter>
				</Form>
			</DialogContent>
		</Dialog>
	);
};
