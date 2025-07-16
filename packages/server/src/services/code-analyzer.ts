import * as path from "path";
import { TRPCError } from "@trpc/server";
import * as fs from "fs/promises";

export interface AnalysisResult {
	detectedLanguage: string;
	detectedFramework: string;
	buildPack: "nixpacks" | "dockerfile" | "static";
	buildPackConfig: Record<string, unknown>;
	startCommand?: string;
	installCommand?: string;
	buildPath: string;
	port: number;
	healthCheck?: {
		path: string;
		interval: string;
	};
	environment?: Record<string, string>;
	dependencies?: string[];
}

export interface JavaScriptFrameworkAnalysis {
	framework: string;
	startCommand?: string;
	buildCommand?: string;
	port: number;
	outputDir?: string;
}

export class CodeAnalyzerService {
	async analyze(repoPath: string): Promise<AnalysisResult> {
		try {
			// 优先检查 Dockerfile
			const dockerfilePath = path.join(repoPath, "Dockerfile");
			if (await this.pathExists(dockerfilePath)) {
				return await this.analyzeDockerfile(dockerfilePath);
			}

			// 检查是否为静态站点
			const staticSiteResult = await this.analyzeStaticSite(repoPath);
			if (staticSiteResult) {
				return staticSiteResult;
			}

			// 使用 Nixpacks 进行智能分析
			return await this.analyzeWithNixpacks(repoPath);
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to analyze repository: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	private async analyzeDockerfile(
		dockerfilePath: string,
	): Promise<AnalysisResult> {
		const dockerfileContent = await fs.readFile(dockerfilePath, "utf-8");
		const exposedPort = this.parsePortFromDockerfile(dockerfileContent);

		return {
			detectedLanguage: "dockerfile",
			detectedFramework: "docker",
			buildPack: "dockerfile",
			buildPackConfig: {},
			buildPath: "/",
			port: exposedPort || 8080,
			healthCheck: {
				path: "/health",
				interval: "30s",
			},
		};
	}

	private async analyzeStaticSite(
		repoPath: string,
	): Promise<AnalysisResult | null> {
		// 检查常见的静态站点标识文件
		const staticIndicators = [
			"index.html",
			"_config.yml", // Jekyll
			"gatsby-config.js", // Gatsby
			"gridsome.config.js", // Gridsome
			"hugo.toml", // Hugo
			"config.toml", // Hugo
		];

		for (const indicator of staticIndicators) {
			if (await this.pathExists(path.join(repoPath, indicator))) {
				const framework = this.detectStaticFramework(indicator);
				return {
					detectedLanguage: "html",
					detectedFramework: framework,
					buildPack: "static",
					buildPackConfig: {},
					buildPath: "/",
					port: 80,
				};
			}
		}

		return null;
	}

	private async analyzeWithNixpacks(repoPath: string): Promise<AnalysisResult> {
		// JavaScript/TypeScript 项目分析
		const packageJsonPath = path.join(repoPath, "package.json");
		if (await this.pathExists(packageJsonPath)) {
			return await this.analyzeJavaScriptProject(repoPath, packageJsonPath);
		}

		// Python 项目分析
		const requirementsTxtPath = path.join(repoPath, "requirements.txt");
		const pyprojectTomlPath = path.join(repoPath, "pyproject.toml");
		if (
			(await this.pathExists(requirementsTxtPath)) ||
			(await this.pathExists(pyprojectTomlPath))
		) {
			return await this.analyzePythonProject(repoPath);
		}

		// Go 项目分析
		const goModPath = path.join(repoPath, "go.mod");
		if (await this.pathExists(goModPath)) {
			return await this.analyzeGoProject(repoPath);
		}

		// Rust 项目分析
		const cargoTomlPath = path.join(repoPath, "Cargo.toml");
		if (await this.pathExists(cargoTomlPath)) {
			return await this.analyzeRustProject(repoPath);
		}

		// Java 项目分析
		const pomXmlPath = path.join(repoPath, "pom.xml");
		const buildGradlePath = path.join(repoPath, "build.gradle");
		if (
			(await this.pathExists(pomXmlPath)) ||
			(await this.pathExists(buildGradlePath))
		) {
			return await this.analyzeJavaProject(repoPath);
		}

		// PHP 项目分析
		const composerJsonPath = path.join(repoPath, "composer.json");
		if (await this.pathExists(composerJsonPath)) {
			return await this.analyzePHPProject(repoPath);
		}

		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Could not determine project type. Supported types: JavaScript/TypeScript, Python, Go, Rust, Java, PHP, Docker, Static sites",
		});
	}

	private async analyzeJavaScriptProject(
		repoPath: string,
		packageJsonPath: string,
	): Promise<AnalysisResult> {
		const packageContent = await fs.readFile(packageJsonPath, "utf-8");
		const pkg = JSON.parse(packageContent);

		const frameworkAnalysis = this.detectJSFramework(
			pkg.dependencies || {},
			pkg.devDependencies || {},
		);
		const installCommand = await this.detectPackageManager(repoPath);

		return {
			detectedLanguage: "javascript",
			detectedFramework: frameworkAnalysis.framework,
			buildPack: "nixpacks",
			buildPackConfig: {
				packageManager: installCommand.split(" ")[0],
			},
			startCommand:
				frameworkAnalysis.startCommand || pkg.scripts?.start || "npm start",
			installCommand: installCommand,
			buildPath: "/",
			port: frameworkAnalysis.port,
			environment: this.extractEnvironmentVariables(pkg),
			dependencies: Object.keys({
				...pkg.dependencies,
				...pkg.devDependencies,
			}),
			healthCheck: {
				path: "/",
				interval: "30s",
			},
		};
	}

	private async analyzePythonProject(
		repoPath: string,
	): Promise<AnalysisResult> {
		const framework = await this.detectPythonFramework(repoPath);

		return {
			detectedLanguage: "python",
			detectedFramework: framework.name,
			buildPack: "nixpacks",
			buildPackConfig: {},
			startCommand: framework.startCommand,
			installCommand: "pip install -r requirements.txt",
			buildPath: "/",
			port: framework.port,
			healthCheck: {
				path: framework.healthPath || "/health",
				interval: "30s",
			},
		};
	}

	private async analyzeGoProject(repoPath: string): Promise<AnalysisResult> {
		const goModPath = path.join(repoPath, "go.mod");
		const goModContent = await fs.readFile(goModPath, "utf-8");
		const moduleName = goModContent.match(/module\s+(.+)/)?.[1] || "main";

		return {
			detectedLanguage: "go",
			detectedFramework: "go",
			buildPack: "nixpacks",
			buildPackConfig: {},
			startCommand: "./main",
			buildPath: "/",
			port: 8080,
			environment: {
				CGO_ENABLED: "0",
				GOOS: "linux",
			},
		};
	}

	private async analyzeRustProject(repoPath: string): Promise<AnalysisResult> {
		return {
			detectedLanguage: "rust",
			detectedFramework: "rust",
			buildPack: "nixpacks",
			buildPackConfig: {},
			buildPath: "/",
			port: 8080,
		};
	}

	private async analyzeJavaProject(repoPath: string): Promise<AnalysisResult> {
		const buildTool = (await this.pathExists(path.join(repoPath, "pom.xml")))
			? "maven"
			: "gradle";

		return {
			detectedLanguage: "java",
			detectedFramework: buildTool,
			buildPack: "nixpacks",
			buildPackConfig: {},
			buildPath: "/",
			port: 8080,
			startCommand:
				buildTool === "maven"
					? "java -jar target/*.jar"
					: "java -jar build/libs/*.jar",
		};
	}

	private async analyzePHPProject(repoPath: string): Promise<AnalysisResult> {
		const composerJsonPath = path.join(repoPath, "composer.json");
		const composerContent = await fs.readFile(composerJsonPath, "utf-8");
		const composer = JSON.parse(composerContent);

		const framework = this.detectPHPFramework(composer.require || {});

		return {
			detectedLanguage: "php",
			detectedFramework: framework,
			buildPack: "nixpacks",
			buildPackConfig: {},
			installCommand: "composer install",
			buildPath: "/",
			port: 8080,
			startCommand: "php -S 0.0.0.0:8080 -t public",
		};
	}

	private detectJSFramework(
		deps: Record<string, string>,
		devDeps: Record<string, string>,
	): JavaScriptFrameworkAnalysis {
		const allDeps = { ...deps, ...devDeps };

		if (allDeps.next) {
			return {
				framework: "Next.js",
				startCommand: "npm start",
				buildCommand: "npm run build",
				port: 3000,
				outputDir: ".next",
			};
		}

		if (allDeps["@sveltejs/kit"]) {
			return {
				framework: "SvelteKit",
				startCommand: "npm start",
				buildCommand: "npm run build",
				port: 3000,
			};
		}

		if (allDeps.nuxt) {
			return {
				framework: "Nuxt.js",
				startCommand: "npm start",
				buildCommand: "npm run build",
				port: 3000,
			};
		}

		if (allDeps.vue) {
			return {
				framework: "Vue.js",
				startCommand: "npm run serve",
				buildCommand: "npm run build",
				port: 8080,
			};
		}

		if (allDeps.react) {
			return {
				framework: "React",
				startCommand: "npm start",
				buildCommand: "npm run build",
				port: 3000,
			};
		}

		if (allDeps.express) {
			return {
				framework: "Express.js",
				startCommand: "npm start",
				port: 3000,
			};
		}

		if (allDeps.fastify) {
			return {
				framework: "Fastify",
				startCommand: "npm start",
				port: 3000,
			};
		}

		return {
			framework: "Node.js",
			startCommand: "npm start",
			port: 3000,
		};
	}

	private async detectPythonFramework(repoPath: string): Promise<{
		name: string;
		startCommand: string;
		port: number;
		healthPath?: string;
	}> {
		const requirementsPaths = [
			path.join(repoPath, "requirements.txt"),
			path.join(repoPath, "pyproject.toml"),
		];

		for (const reqPath of requirementsPaths) {
			if (await this.pathExists(reqPath)) {
				const content = await fs.readFile(reqPath, "utf-8");

				if (content.includes("django")) {
					return {
						name: "Django",
						startCommand: "python manage.py runserver 0.0.0.0:8000",
						port: 8000,
						healthPath: "/admin/",
					};
				}

				if (content.includes("flask")) {
					return {
						name: "Flask",
						startCommand: "python app.py",
						port: 5000,
					};
				}

				if (content.includes("fastapi")) {
					return {
						name: "FastAPI",
						startCommand: "uvicorn main:app --host 0.0.0.0 --port 8000",
						port: 8000,
						healthPath: "/docs",
					};
				}
			}
		}

		return {
			name: "Python",
			startCommand: "python main.py",
			port: 8000,
		};
	}

	private detectPHPFramework(dependencies: Record<string, string>): string {
		if (dependencies["laravel/framework"]) return "Laravel";
		if (dependencies["symfony/framework-bundle"]) return "Symfony";
		if (dependencies["cakephp/cakephp"]) return "CakePHP";
		return "PHP";
	}

	private detectStaticFramework(indicator: string): string {
		if (indicator === "_config.yml") return "Jekyll";
		if (indicator === "gatsby-config.js") return "Gatsby";
		if (indicator === "gridsome.config.js") return "Gridsome";
		if (indicator.includes("hugo")) return "Hugo";
		return "Static HTML";
	}

	private async detectPackageManager(repoPath: string): Promise<string> {
		if (await this.pathExists(path.join(repoPath, "pnpm-lock.yaml"))) {
			return "pnpm install";
		}
		if (await this.pathExists(path.join(repoPath, "yarn.lock"))) {
			return "yarn install";
		}
		if (await this.pathExists(path.join(repoPath, "bun.lockb"))) {
			return "bun install";
		}
		return "npm install";
	}

	private extractEnvironmentVariables(pkg: any): Record<string, string> {
		const env: Record<string, string> = {};

		// Common Node.js environment variables
		if (pkg.engines?.node) {
			env.NODE_VERSION = pkg.engines.node;
		}

		return env;
	}

	private parsePortFromDockerfile(content: string): number | null {
		const exposeMatch = content.match(/^EXPOSE\s+(\d+)/im);
		return exposeMatch ? Number.parseInt(exposeMatch[1]!, 10) : null;
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}
}
