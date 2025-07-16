import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import {
	AlertCircle,
	Calendar,
	CheckCircle,
	Clock,
	ExternalLink,
	GitBranch,
	History,
	Play,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type DeploymentStatus = "pending" | "deploying" | "deployed" | "failed";

interface DeployedProject {
	id: string;
	name: string;
	githubUrl: string;
	dokployApplicationId?: string;
	status: DeploymentStatus;
	createdAt: string;
	analysisCache?: {
		language?: string;
		framework?: string;
		port?: number;
	};
}

interface Props {
	projectId: string;
}

const getStatusIcon = (status: DeploymentStatus) => {
	switch (status) {
		case "pending":
			return <Clock className="size-4 text-yellow-500" />;
		case "deploying":
			return <RefreshCw className="size-4 text-blue-500 animate-spin" />;
		case "deployed":
			return <CheckCircle className="size-4 text-green-500" />;
		case "failed":
			return <XCircle className="size-4 text-red-500" />;
		default:
			return <AlertCircle className="size-4 text-gray-500" />;
	}
};

const getStatusColor = (status: DeploymentStatus) => {
	switch (status) {
		case "pending":
			return "bg-yellow-100 text-yellow-800 border-yellow-200";
		case "deploying":
			return "bg-blue-100 text-blue-800 border-blue-200";
		case "deployed":
			return "bg-green-100 text-green-800 border-green-200";
		case "failed":
			return "bg-red-100 text-red-800 border-red-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
};

export const DeployedProjectsManager = ({ projectId }: Props) => {
	const utils = api.useUtils();
	const [visible, setVisible] = useState(false);
	const [selectedProject, setSelectedProject] = useState<string | null>(null);

	const {
		data: deployedProjects,
		isLoading,
		error,
	} = api.project.listDeployedProjects.useQuery(undefined, {
		enabled: visible,
	});

	const { mutateAsync: deleteProject, isLoading: isDeleting } =
		api.project.deleteImportedProject.useMutation();

	const { mutateAsync: deployProject, isLoading: isDeploying } =
		api.project.deployImportedProject.useMutation();

	const { data: deploymentHistory } =
		api.project.getImportedProjectDeployments.useQuery(
			{ deployedProjectId: selectedProject! },
			{ enabled: !!selectedProject },
		);

	const handleDeleteProject = async (
		deployedProjectId: string,
		projectName: string,
	) => {
		if (
			!confirm(
				`Are you sure you want to delete "${projectName}"? This action cannot be undone.`,
			)
		) {
			return;
		}

		try {
			await deleteProject({ deployedProjectId });
			toast.success("Project deleted successfully");
			await utils.project.listDeployedProjects.invalidate();
		} catch (error) {
			toast.error("Failed to delete project");
		}
	};

	const handleDeployProject = async (
		deployedProjectId: string,
		projectName: string,
	) => {
		try {
			await deployProject({ deployedProjectId });
			toast.success(`Deployment started for "${projectName}"`);
			await utils.project.listDeployedProjects.invalidate();
		} catch (error) {
			toast.error("Failed to start deployment");
		}
	};

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const extractRepoInfo = (githubUrl: string) => {
		try {
			const url = new URL(githubUrl);
			const [, owner, repo] = url.pathname.split("/");
			return { owner, repo };
		} catch {
			return { owner: "Unknown", repo: "Unknown" };
		}
	};

	return (
		<Dialog open={visible} onOpenChange={setVisible}>
			<DialogTrigger className="w-full">
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3"
					onSelect={(e) => e.preventDefault()}
				>
					<History className="size-4 text-muted-foreground" />
					<span>Manage Imports</span>
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent className="sm:max-w-6xl max-h-[90vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Imported Projects Manager</DialogTitle>
					<DialogDescription>
						View and manage your imported GitHub projects and their deployment
						history
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-hidden">
					{isLoading && (
						<div className="flex items-center justify-center p-8">
							<RefreshCw className="size-6 animate-spin" />
							<span className="ml-2">Loading projects...</span>
						</div>
					)}

					{error && (
						<AlertBlock type="error">
							Failed to load projects: {error.message}
						</AlertBlock>
					)}

					{!isLoading &&
						!error &&
						(!deployedProjects || deployedProjects.length === 0) && (
							<Card>
								<CardContent className="flex items-center justify-center p-8">
									<div className="text-center space-y-2">
										<History className="size-12 text-muted-foreground mx-auto" />
										<h3 className="font-semibold">No imported projects yet</h3>
										<p className="text-muted-foreground">
											Import your first GitHub repository to get started
										</p>
									</div>
								</CardContent>
							</Card>
						)}

					{!isLoading &&
						!error &&
						deployedProjects &&
						deployedProjects.length > 0 && (
							<div className="space-y-4">
								<div className="grid gap-4">
									{deployedProjects.map((project: DeployedProject) => {
										const { owner, repo } = extractRepoInfo(project.githubUrl);

										return (
											<Card
												key={project.id}
												className="hover:shadow-md transition-shadow"
											>
												<CardHeader className="pb-3">
													<div className="flex items-start justify-between">
														<div className="space-y-1">
															<CardTitle className="text-lg flex items-center gap-2">
																{project.name}
																<Badge
																	className={getStatusColor(project.status)}
																>
																	{getStatusIcon(project.status)}
																	<span className="ml-1 capitalize">
																		{project.status}
																	</span>
																</Badge>
															</CardTitle>
															<CardDescription className="flex items-center gap-2">
																<GitBranch className="size-4" />
																{owner}/{repo}
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-auto p-1 ml-1"
																	onClick={() =>
																		window.open(project.githubUrl, "_blank")
																	}
																>
																	<ExternalLink className="size-3" />
																</Button>
															</CardDescription>
														</div>

														<div className="flex items-center gap-2">
															<TooltipProvider delayDuration={0}>
																<Tooltip>
																	<TooltipTrigger asChild>
																		<Button
																			variant="outline"
																			size="sm"
																			onClick={() =>
																				handleDeployProject(
																					project.id,
																					project.name,
																				)
																			}
																			disabled={
																				isDeploying ||
																				project.status === "deploying"
																			}
																		>
																			{isDeploying ? (
																				<RefreshCw className="size-4 animate-spin" />
																			) : (
																				<Play className="size-4" />
																			)}
																			Deploy
																		</Button>
																	</TooltipTrigger>
																	<TooltipContent>
																		{project.status === "deployed"
																			? "Redeploy this project"
																			: "Deploy this project"}
																	</TooltipContent>
																</Tooltip>
															</TooltipProvider>

															<TooltipProvider delayDuration={0}>
																<Tooltip>
																	<TooltipTrigger asChild>
																		<Button
																			variant="outline"
																			size="sm"
																			onClick={() =>
																				handleDeleteProject(
																					project.id,
																					project.name,
																				)
																			}
																			disabled={isDeleting}
																		>
																			<Trash2 className="size-4 text-red-500" />
																		</Button>
																	</TooltipTrigger>
																	<TooltipContent>
																		Delete this imported project
																	</TooltipContent>
																</Tooltip>
															</TooltipProvider>
														</div>
													</div>
												</CardHeader>

												<CardContent className="pt-0">
													<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
														{project.analysisCache?.language && (
															<div>
																<span className="text-muted-foreground">
																	Language:
																</span>
																<div className="font-medium">
																	{project.analysisCache.language}
																</div>
															</div>
														)}

														{project.analysisCache?.framework && (
															<div>
																<span className="text-muted-foreground">
																	Framework:
																</span>
																<div className="font-medium">
																	{project.analysisCache.framework}
																</div>
															</div>
														)}

														{project.analysisCache?.port && (
															<div>
																<span className="text-muted-foreground">
																	Port:
																</span>
																<div className="font-medium">
																	{project.analysisCache.port}
																</div>
															</div>
														)}

														<div>
															<span className="text-muted-foreground">
																Imported:
															</span>
															<div className="font-medium flex items-center gap-1">
																<Calendar className="size-3" />
																{formatDate(project.createdAt)}
															</div>
														</div>
													</div>

													{project.dokployApplicationId && (
														<div className="mt-3 pt-3 border-t">
															<div className="text-sm">
																<span className="text-muted-foreground">
																	Dokploy App ID:
																</span>
																<span className="ml-2 font-mono text-xs bg-muted px-2 py-1 rounded">
																	{project.dokployApplicationId}
																</span>
															</div>
														</div>
													)}
												</CardContent>
											</Card>
										);
									})}
								</div>

								{/* Deployment History for Selected Project */}
								{selectedProject && deploymentHistory && (
									<Card>
										<CardHeader>
											<CardTitle>Deployment History</CardTitle>
											<CardDescription>
												Recent deployments for the selected project
											</CardDescription>
										</CardHeader>
										<CardContent>
											<div className="max-h-[300px] overflow-y-auto">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>Date</TableHead>
															<TableHead>Status</TableHead>
															<TableHead>Duration</TableHead>
															<TableHead>Actions</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{deploymentHistory.map((deployment: any) => (
															<TableRow key={deployment.id}>
																<TableCell>
																	{formatDate(deployment.createdAt)}
																</TableCell>
																<TableCell>
																	<Badge
																		className={getStatusColor(
																			deployment.status,
																		)}
																	>
																		{getStatusIcon(deployment.status)}
																		<span className="ml-1 capitalize">
																			{deployment.status}
																		</span>
																	</Badge>
																</TableCell>
																<TableCell>
																	{deployment.duration
																		? `${deployment.duration}s`
																		: "-"}
																</TableCell>
																<TableCell>
																	<Button variant="ghost" size="sm">
																		View Logs
																	</Button>
																</TableCell>
															</TableRow>
														))}
													</TableBody>
												</Table>
											</div>
										</CardContent>
									</Card>
								)}
							</div>
						)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
