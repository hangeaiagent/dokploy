# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dokploy is a free, self-hostable Platform as a Service (PaaS) that simplifies deployment and management of applications and databases. It's built as a monorepo with multiple applications using Node.js, TypeScript, Next.js, and PostgreSQL.

## Architecture

### Monorepo Structure
- **`/apps/dokploy/`** - Main Next.js web application with UI components and pages
- **`/packages/server/`** - Core shared library providing database, authentication, and business logic
- **`/apps/api/`** - Standalone API service  
- **`/apps/schedules/`** - Background job processing service
- **`/apps/monitoring/`** - Go-based monitoring service

### Key Technologies
- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS, tRPC
- **Backend**: Node.js, PostgreSQL, Drizzle ORM, Better-auth
- **Infrastructure**: Docker, Docker Swarm, Traefik, BullMQ
- **Build Systems**: Nixpacks, Heroku buildpacks, Docker
- **Git Providers**: GitHub, GitLab, Bitbucket, Gitea

## Common Development Commands

### Setup and Development
```bash
# Initial setup
pnpm install
cp apps/dokploy/.env.example apps/dokploy/.env
pnpm run dokploy:setup

# Development server
pnpm run dokploy:dev

# Development with Turbopack
pnpm run dokploy:dev:turbopack
```

### Build and Test
```bash
# Build all packages
pnpm run build

# Build specific dokploy app
pnpm run dokploy:build

# Run tests
pnpm run test

# Type checking
pnpm run typecheck
```

### Database Operations
```bash
# Database migrations
pnpm run migration:generate
pnpm run migration:run

# Database studio
pnpm run studio

# Database seeding
pnpm run db:seed
```

### Code Quality
```bash
# Lint and format (using Biome)
pnpm run format-and-lint:fix

# Check without fixing
pnpm run format-and-lint
```

## Database Schema

The application uses PostgreSQL with Drizzle ORM. Key entities include:

### Core Entities
- **`projects`** - Main organizational unit
- **`applications`** - Deployed applications with various source types
- **`users_temp`** - User management and authentication
- **`organization`** - Multi-tenant organization structure

### Infrastructure
- **`deployments`** - Deployment history and status
- **`domains`** - Domain management and SSL certificates
- **`compose`** - Docker Compose stack management
- **`server`** - Remote server management

### Database Services
- **`postgres`**, **`mysql`**, **`mariadb`**, **`mongo`**, **`redis`** - Database service configurations
- **`backups`** - Database backup management
- **`volume-backups`** - Volume backup system

## Key Code Patterns

### tRPC Router Structure
API endpoints are defined in `/apps/dokploy/server/api/routers/` using tRPC with protected procedures:

```typescript
export const applicationRouter = createTRPCRouter({
  create: protectedProcedure
    .input(apiCreateApplication)
    .mutation(async ({ input, ctx }) => {
      // Implementation
    }),
});
```

### Database Access
All database operations use the `@dokploy/server` package:

```typescript
import { db } from "@/server/db";
import { applications } from "@/server/db/schema";

// Query example
const app = await db.query.applications.findFirst({
  where: eq(applications.applicationId, id),
});
```

### Docker Integration
Docker operations are handled through the server package utilities:

```typescript
import { startService, stopService } from "@dokploy/server";

// Start/stop services
await startService(applicationId);
await stopService(applicationId);
```

## Important File Locations

### Configuration Files
- **`/apps/dokploy/.env`** - Main environment configuration
- **`/apps/dokploy/server/db/drizzle.config.ts`** - Database configuration
- **`/biome.json`** - Linter and formatter configuration

### Schema and Types
- **`/packages/server/src/db/schema/`** - Database schema definitions
- **`/apps/dokploy/server/db/validations/`** - Input validation schemas

### UI Components
- **`/apps/dokploy/components/ui/`** - Reusable UI components
- **`/apps/dokploy/components/dashboard/`** - Dashboard-specific components

## Git Workflow

- **Main branch**: `canary` (development branch)
- **Stable branch**: `main` (production releases)
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
- Use `feat:`, `fix:`, `docs:`, `refactor:`, etc. prefixes

## Development Notes

### Environment Setup
- **Node.js**: v20.16.0 (use nvm for version management)
- **Package Manager**: pnpm >=9.5.0
- **Database**: PostgreSQL required for development

### Code Quality
- Uses Biome for linting and formatting (not Prettier)
- Strict TypeScript configuration
- Lefthook for git hooks (currently disabled)

### Docker Requirements
- Docker and Docker Compose must be installed
- Used for building and running applications
- Required for local development and testing

### Testing
- Uses Vitest for testing
- Test files located in `/apps/dokploy/__test__/`
- Run tests with `pnpm run test`

## Build Systems Support

Dokploy supports multiple build systems:
- **Docker**: Custom Dockerfile builds
- **Nixpacks**: Automatic buildpack detection
- **Heroku Buildpacks**: Legacy buildpack support
- **Static Sites**: For static site deployments

## Authentication & Security

- Uses Better-auth library for authentication
- Supports social providers (GitHub, GitLab, etc.)
- 2FA support with OTP
- Role-based access control
- SSL certificate management through Let's Encrypt

## Deployment Architecture

- **Traefik**: Reverse proxy and load balancing
- **Docker Swarm**: Container orchestration
- **BullMQ**: Background job processing
- **PostgreSQL**: Primary database
- **Redis**: Caching and queue storage (via BullMQ)

## AI Integration

The platform includes AI assistant features supporting multiple providers:
- OpenAI, Anthropic, Azure OpenAI, Mistral, Cohere, and others
- Template generation and deployment assistance
- Configured in `/apps/dokploy/components/dashboard/project/ai/`