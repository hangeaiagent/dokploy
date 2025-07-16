import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
	AlertCircle,
	CheckCircle,
	Clock,
	Code,
	ExternalLink,
	GitBranch,
	Loader2,
	Rocket,
	Settings,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

type ImportStep =
	| "analyzing"
	| "configuring"
	| "building"
	| "deploying"
	| "completed"
	| "failed";

interface ImportProgress {
	step: ImportStep;
	progress: number;
	message: string;
	details?: string;
	startTime: Date;
	error?: string;
}

interface Props {
	projectId: string;
	deployedProjectId?: string;
	isVisible: boolean;
	onClose: () => void;
	githubUrl?: string;
	projectName?: string;
}

const importSteps: Array<{
	step: ImportStep;
	title: string;
	description: string;
	icon: React.ReactNode;
}> = [
	{
		step: "analyzing",
		title: "Analyzing Repository",
		description: "Examining code structure and dependencies",
		icon: <Code className="size-4" />,
	},
	{
		step: "configuring",
		title: "Generating Configuration",
		description: "Creating Dockerfile and deployment settings",
		icon: <Settings className="size-4" />,
	},
	{
		step: "building",
		title: "Building Application",
		description: "Compiling and preparing the application",
		icon: <Loader2 className="size-4" />,
	},
	{
		step: "deploying",
		title: "Deploying",
		description: "Starting the deployment process",
		icon: <Rocket className="size-4" />,
	},
	{
		step: "completed",
		title: "Completed",
		description: "Import and deployment successful",
		icon: <CheckCircle className="size-4" />,
	},
];

export const ImportProgressTracker = ({
	projectId,
	deployedProjectId,
	isVisible,
	onClose,
	githubUrl,
	projectName,
}: Props) => {
	const [importProgress, setImportProgress] = useState<ImportProgress>({
		step: "analyzing",
		progress: 0,
		message: "Starting repository analysis...",
		startTime: new Date(),
	});

	// Simulate progress updates
	useEffect(() => {
		if (!isVisible) return;

		const progressUpdates: Array<{
			step: ImportStep;
			progress: number;
			message: string;
			details?: string;
			delay: number;
		}> = [
			{
				step: "analyzing",
				progress: 20,
				message: "Cloning repository...",
				details: "Downloading source code from GitHub",
				delay: 1000,
			},
			{
				step: "analyzing",
				progress: 40,
				message: "Detecting project structure...",
				details: "Identifying frameworks and dependencies",
				delay: 2000,
			},
			{
				step: "analyzing",
				progress: 60,
				message: "Analyzing build requirements...",
				details: "Determining build system and configuration",
				delay: 1500,
			},
			{
				step: "configuring",
				progress: 70,
				message: "Generating Dockerfile...",
				details: "Creating optimized container configuration",
				delay: 2000,
			},
			{
				step: "configuring",
				progress: 85,
				message: "Setting up environment variables...",
				details: "Configuring deployment settings",
				delay: 1000,
			},
			{
				step: "building",
				progress: 90,
				message: "Building Docker image...",
				details: "This may take several minutes",
				delay: 3000,
			},
			{
				step: "deploying",
				progress: 95,
				message: "Starting deployment...",
				details: "Initializing application containers",
				delay: 2000,
			},
			{
				step: "completed",
				progress: 100,
				message: "Import completed successfully!",
				details: "Your application is now running",
				delay: 1000,
			},
		];

		let currentIndex = 0;

		const updateProgress = () => {
			if (currentIndex < progressUpdates.length) {
				const update = progressUpdates[currentIndex];
				setImportProgress((prev) => ({
					...prev,
					...update,
				}));

				currentIndex++;
				setTimeout(updateProgress, update.delay);
			}
		};

		updateProgress();
	}, [isVisible]);

	const getStepStatus = (step: ImportStep) => {
		const currentStepIndex = importSteps.findIndex(
			(s) => s.step === importProgress.step,
		);
		const stepIndex = importSteps.findIndex((s) => s.step === step);

		if (importProgress.step === "failed") {
			return stepIndex <= currentStepIndex ? "failed" : "pending";
		}

		if (stepIndex < currentStepIndex) return "completed";
		if (stepIndex === currentStepIndex) return "current";
		return "pending";
	};

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle className="size-4 text-green-500" />;
			case "current":
				return <Loader2 className="size-4 text-blue-500 animate-spin" />;
			case "failed":
				return <XCircle className="size-4 text-red-500" />;
			default:
				return <Clock className="size-4 text-gray-400" />;
		}
	};

	const formatDuration = () => {
		const now = new Date();
		const diff = Math.floor(
			(now.getTime() - importProgress.startTime.getTime()) / 1000,
		);
		const minutes = Math.floor(diff / 60);
		const seconds = diff % 60;
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	};

	const extractRepoInfo = (url?: string) => {
		if (!url) return { owner: "", repo: "" };
		try {
			const urlObj = new URL(url);
			const [, owner, repo] = urlObj.pathname.split("/");
			return { owner, repo };
		} catch {
			return { owner: "", repo: "" };
		}
	};

	const { owner, repo } = extractRepoInfo(githubUrl);

	return (
		<Dialog open={isVisible} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<GitBranch className="size-5" />
						Import Progress
					</DialogTitle>
					<DialogDescription>
						Importing {projectName || `${owner}/${repo}`} from GitHub
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					{/* Repository Info */}
					<Card>
						<CardContent className="pt-6">
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="font-medium">{projectName || repo}</div>
									<div className="text-sm text-muted-foreground flex items-center gap-2">
										{githubUrl && (
											<>
												<span>
													{owner}/{repo}
												</span>
												<Button
													variant="ghost"
													size="sm"
													className="h-auto p-1"
													onClick={() => window.open(githubUrl, "_blank")}
												>
													<ExternalLink className="size-3" />
												</Button>
											</>
										)}
									</div>
								</div>
								<div className="text-right text-sm text-muted-foreground">
									<div>Duration: {formatDuration()}</div>
									{deployedProjectId && (
										<div className="font-mono text-xs">
											ID: {deployedProjectId.slice(0, 8)}...
										</div>
									)}
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Overall Progress */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Overall Progress</span>
							<span className="text-sm text-muted-foreground">
								{importProgress.progress}%
							</span>
						</div>
						<Progress value={importProgress.progress} className="h-2" />
					</div>

					{/* Current Status */}
					<Card>
						<CardContent className="pt-6">
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									{importProgress.step === "failed" ? (
										<AlertCircle className="size-4 text-red-500" />
									) : (
										<Loader2 className="size-4 text-blue-500 animate-spin" />
									)}
									<span className="font-medium">{importProgress.message}</span>
								</div>
								{importProgress.details && (
									<p className="text-sm text-muted-foreground ml-6">
										{importProgress.details}
									</p>
								)}
								{importProgress.error && (
									<AlertBlock type="error" className="ml-6">
										{importProgress.error}
									</AlertBlock>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Step Progress */}
					<div className="space-y-3">
						<h4 className="font-medium">Import Steps</h4>
						<div className="space-y-2">
							{importSteps.slice(0, -1).map((step) => {
								const status = getStepStatus(step.step);
								return (
									<div
										key={step.step}
										className={`flex items-center gap-3 p-3 rounded-lg border ${
											status === "current"
												? "border-blue-200 bg-blue-50"
												: status === "completed"
													? "border-green-200 bg-green-50"
													: status === "failed"
														? "border-red-200 bg-red-50"
														: "border-gray-200"
										}`}
									>
										{getStatusIcon(status)}
										<div className="flex-1">
											<div className="font-medium text-sm">{step.title}</div>
											<div className="text-xs text-muted-foreground">
												{step.description}
											</div>
										</div>
										<Badge
											variant={
												status === "completed"
													? "default"
													: status === "current"
														? "secondary"
														: status === "failed"
															? "destructive"
															: "outline"
											}
										>
											{status === "current" ? "In Progress" : status}
										</Badge>
									</div>
								);
							})}
						</div>
					</div>

					{/* Completion Status */}
					{importProgress.step === "completed" && (
						<Card className="border-green-200 bg-green-50">
							<CardContent className="pt-6">
								<div className="flex items-center gap-2 text-green-700">
									<CheckCircle className="size-5" />
									<span className="font-medium">
										Import completed successfully!
									</span>
								</div>
								<p className="text-sm text-green-600 mt-2">
									Your application has been imported and deployed. You can now
									manage it from the project dashboard.
								</p>
							</CardContent>
						</Card>
					)}

					{/* Error Status */}
					{importProgress.step === "failed" && (
						<Card className="border-red-200 bg-red-50">
							<CardContent className="pt-6">
								<div className="flex items-center gap-2 text-red-700">
									<XCircle className="size-5" />
									<span className="font-medium">Import failed</span>
								</div>
								<p className="text-sm text-red-600 mt-2">
									The import process encountered an error. Please check the
									repository and try again, or contact support if the issue
									persists.
								</p>
							</CardContent>
						</Card>
					)}
				</div>

				{/* Footer */}
				<div className="flex justify-end pt-4 border-t">
					{importProgress.step === "completed" ||
					importProgress.step === "failed" ? (
						<Button onClick={onClose}>Close</Button>
					) : (
						<Button variant="outline" onClick={onClose}>
							Run in Background
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
