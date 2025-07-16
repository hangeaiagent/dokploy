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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import {
	Clock,
	Code,
	Download,
	ExternalLink,
	GitFork,
	HelpCircle,
	Search,
	Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	description: string | null;
	html_url: string;
	clone_url: string;
	stargazers_count: number;
	forks_count: number;
	language: string | null;
	updated_at: string;
	private: boolean;
	owner: {
		login: string;
		avatar_url: string;
	};
}

interface Props {
	projectId: string;
	onRepoSelect?: (repo: GitHubRepo) => void;
}

export const GitHubBrowser = ({ projectId, onRepoSelect }: Props) => {
	const utils = api.useUtils();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { data: servers } = api.server.withSSHKey.useQuery();

	const [visible, setVisible] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
	const [githubToken, setGithubToken] = useState("");
	const [searchResults, setSearchResults] = useState<GitHubRepo[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [selectedServerId, setSelectedServerId] = useState<
		string | undefined
	>();

	const { mutateAsync: ingestFromGithub, isLoading } =
		api.project.ingestFromGithub.useMutation();

	// Mock search function - in a real implementation, this would call GitHub API
	const searchRepositories = async (query: string, token?: string) => {
		if (!query.trim()) {
			setSearchResults([]);
			return;
		}

		setIsSearching(true);
		try {
			// For demo purposes, showing some popular repositories
			// In real implementation, this would make actual GitHub API calls
			const mockResults: GitHubRepo[] = [
				{
					id: 1,
					name: "react",
					full_name: "facebook/react",
					description:
						"A declarative, efficient, and flexible JavaScript library for building user interfaces.",
					html_url: "https://github.com/facebook/react",
					clone_url: "https://github.com/facebook/react.git",
					stargazers_count: 220000,
					forks_count: 45000,
					language: "JavaScript",
					updated_at: new Date().toISOString(),
					private: false,
					owner: {
						login: "facebook",
						avatar_url: "https://avatars.githubusercontent.com/u/69631?v=4",
					},
				},
				{
					id: 2,
					name: "next.js",
					full_name: "vercel/next.js",
					description: "The React Framework for the Web",
					html_url: "https://github.com/vercel/next.js",
					clone_url: "https://github.com/vercel/next.js.git",
					stargazers_count: 120000,
					forks_count: 26000,
					language: "TypeScript",
					updated_at: new Date().toISOString(),
					private: false,
					owner: {
						login: "vercel",
						avatar_url: "https://avatars.githubusercontent.com/u/14985020?v=4",
					},
				},
			].filter(
				(repo) =>
					repo.name.toLowerCase().includes(query.toLowerCase()) ||
					repo.description?.toLowerCase().includes(query.toLowerCase()),
			);

			setSearchResults(mockResults);
		} catch (error) {
			toast.error("Failed to search repositories");
		} finally {
			setIsSearching(false);
		}
	};

	useEffect(() => {
		const debounceTimer = setTimeout(() => {
			searchRepositories(searchQuery, githubToken);
		}, 500);

		return () => clearTimeout(debounceTimer);
	}, [searchQuery, githubToken]);

	const handleImportRepo = async () => {
		if (!selectedRepo) return;

		try {
			await ingestFromGithub({
				githubUrl: selectedRepo.html_url,
				projectId,
				customName: selectedRepo.name,
				accessToken: githubToken || undefined,
			});

			toast.success(`Successfully imported ${selectedRepo.full_name}`);
			setVisible(false);
			setSelectedRepo(null);
			setSearchQuery("");
			setSearchResults([]);

			await utils.project.one.invalidate({ projectId });
			await utils.project.listDeployedProjects.invalidate();

			if (onRepoSelect) {
				onRepoSelect(selectedRepo);
			}
		} catch (error) {
			toast.error("Failed to import repository");
		}
	};

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleDateString();
	};

	const formatNumber = (num: number) => {
		if (num >= 1000) {
			return `${(num / 1000).toFixed(1)}k`;
		}
		return num.toString();
	};

	return (
		<Dialog open={visible} onOpenChange={setVisible}>
			<DialogTrigger className="w-full">
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3"
					onSelect={(e) => e.preventDefault()}
				>
					<Search className="size-4 text-muted-foreground" />
					<span>Browse GitHub</span>
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Browse GitHub Repositories</DialogTitle>
					<DialogDescription>
						Search and select a GitHub repository to import into your project
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 flex-1 overflow-hidden">
					{/* GitHub Token Input */}
					<div className="space-y-2">
						<TooltipProvider delayDuration={0}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Label className="flex items-center gap-1">
										GitHub Access Token (Optional)
										<HelpCircle className="size-4 text-muted-foreground" />
									</Label>
								</TooltipTrigger>
								<TooltipContent className="w-[300px]" align="start">
									<span>
										Required for private repositories and higher API rate
										limits. Generate a personal access token from GitHub
										Settings.
									</span>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						<Input
							type="password"
							placeholder="ghp_xxxxxxxxxxxx"
							value={githubToken}
							onChange={(e) => setGithubToken(e.target.value)}
						/>
					</div>

					{/* Search Input */}
					<div className="space-y-2">
						<Label>Search Repositories</Label>
						<div className="relative">
							<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
							<Input
								placeholder="Search for repositories..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
					</div>

					{/* Server Selection */}
					<div className="space-y-2">
						<TooltipProvider delayDuration={0}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Label className="flex items-center gap-1">
										Select a Server {!isCloud ? "(Optional)" : ""}
										<HelpCircle className="size-4 text-muted-foreground" />
									</Label>
								</TooltipTrigger>
								<TooltipContent className="w-[300px]" align="start">
									<span>
										If no server is selected, the application will be deployed
										on the server where the user is logged in.
									</span>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						<Select
							onValueChange={setSelectedServerId}
							value={selectedServerId}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select a Server" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{servers?.map((server) => (
										<SelectItem key={server.serverId} value={server.serverId}>
											<span className="flex items-center gap-2 justify-between w-full">
												<span>{server.name}</span>
												<span className="text-muted-foreground text-xs">
													{server.ipAddress}
												</span>
											</span>
										</SelectItem>
									))}
									<SelectLabel>Servers ({servers?.length})</SelectLabel>
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>

					<Separator />

					{/* Search Results */}
					<div className="flex-1 overflow-hidden">
						{isSearching && (
							<div className="flex items-center justify-center p-8">
								<div className="text-muted-foreground">
									Searching repositories...
								</div>
							</div>
						)}

						{!isSearching && searchQuery && searchResults.length === 0 && (
							<div className="flex items-center justify-center p-8">
								<div className="text-muted-foreground">
									No repositories found
								</div>
							</div>
						)}

						{!isSearching && searchResults.length > 0 && (
							<div className="space-y-2 max-h-[400px] overflow-y-auto">
								{searchResults.map((repo) => (
									<div
										key={repo.id}
										className={`p-4 border rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${
											selectedRepo?.id === repo.id
												? "border-primary bg-muted/30"
												: ""
										}`}
										onClick={() => setSelectedRepo(repo)}
									>
										<div className="flex items-start justify-between">
											<div className="flex-1 space-y-2">
												<div className="flex items-center gap-2">
													<span className="font-medium">{repo.full_name}</span>
													{repo.private && (
														<span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
															Private
														</span>
													)}
													<Button
														variant="ghost"
														size="sm"
														className="h-auto p-1"
														onClick={(e) => {
															e.stopPropagation();
															window.open(repo.html_url, "_blank");
														}}
													>
														<ExternalLink className="size-3" />
													</Button>
												</div>

												{repo.description && (
													<p className="text-sm text-muted-foreground line-clamp-2">
														{repo.description}
													</p>
												)}

												<div className="flex items-center gap-4 text-xs text-muted-foreground">
													{repo.language && (
														<div className="flex items-center gap-1">
															<Code className="size-3" />
															{repo.language}
														</div>
													)}
													<div className="flex items-center gap-1">
														<Star className="size-3" />
														{formatNumber(repo.stargazers_count)}
													</div>
													<div className="flex items-center gap-1">
														<GitFork className="size-3" />
														{formatNumber(repo.forks_count)}
													</div>
													<div className="flex items-center gap-1">
														<Clock className="size-3" />
														Updated {formatDate(repo.updated_at)}
													</div>
												</div>
											</div>

											<div className="ml-4">
												<img
													src={repo.owner.avatar_url}
													alt={repo.owner.login}
													className="size-8 rounded-full"
												/>
											</div>
										</div>
									</div>
								))}
							</div>
						)}

						{!searchQuery && (
							<div className="flex items-center justify-center p-8">
								<div className="text-center space-y-2">
									<Search className="size-8 text-muted-foreground mx-auto" />
									<div className="text-muted-foreground">
										Start typing to search GitHub repositories
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				<DialogFooter className="flex items-center justify-between">
					<div className="text-sm text-muted-foreground">
						{selectedRepo && <span>Selected: {selectedRepo.full_name}</span>}
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => {
								setVisible(false);
								setSelectedRepo(null);
								setSearchQuery("");
								setSearchResults([]);
							}}
						>
							Cancel
						</Button>
						<Button
							onClick={handleImportRepo}
							disabled={!selectedRepo || isLoading}
							isLoading={isLoading}
						>
							<Download className="size-4 mr-2" />
							Import Repository
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
