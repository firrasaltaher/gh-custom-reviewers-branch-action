# GitHub Actions CODEOWNERS Reviewer Assignment POC

This proof of concept automatically assigns reviewers to pull requests based on the CODEOWNERS file and posts a notification comment.

> **Test note**: Testing branch-specific reviewer requirements.

## Features

- ✅ Parses CODEOWNERS file and matches changed files to owners
- ✅ Automatically assigns individual reviewers to PRs
- ✅ Supports team reviewer assignment (with proper PAT)
- ✅ Posts a comment to notify all assigned reviewers
- ✅ Tests and reports PAT permissions
- ✅ Graceful fallback if team assignment fails

## GitHub PAT Requirements for Teams

### Understanding the Token Types

#### 1. Default `GITHUB_TOKEN` (Automatic)
- **Scopes:** Limited to the repository
- **Can do:**
  - Read repository files
  - Assign individual user reviewers
  - Create PR comments
- **Cannot do:**
  - Assign team reviewers (requires org-level access)
  - Read organization information
- **Setup:** Automatically available, no configuration needed

#### 2. Personal Access Token (PAT) - Required for Teams
To assign **team reviewers**, you need a PAT with additional scopes.

### Creating a PAT for Team Access

#### Classic PAT (Recommended for POC)
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Select the following scopes:
   - ✅ `repo` (Full control of private repositories)
     - Includes: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`
   - ✅ `read:org` (Read org and team membership)
     - Required to read team information and assign team reviewers
   - ✅ `write:discussion` (optional, for discussions)

#### Fine-grained PAT (More secure, newer)
1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Select repository access (the repos where this action will run)
4. Under "Repository permissions":
   - Pull requests: **Read and write**
   - Contents: **Read**
   - Metadata: **Read**
5. Under "Organization permissions":
   - Members: **Read** (required for team access)

### Comparison: Which PAT Works?

| Token Type | Individual Reviewers | Team Reviewers | Security |
|------------|---------------------|----------------|----------|
| `GITHUB_TOKEN` | ✅ Yes | ❌ No | ⭐⭐⭐ Most secure |
| Classic PAT with `repo` only | ✅ Yes | ❌ No | ⭐⭐ Moderate |
| Classic PAT with `repo` + `read:org` | ✅ Yes | ✅ Yes | ⭐⭐ Moderate |
| Fine-grained PAT (properly configured) | ✅ Yes | ✅ Yes | ⭐⭐⭐ Most secure |

### Adding PAT to Repository Secrets

1. Copy your generated PAT
2. Go to your repository → Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `REVIEWER_PAT`
5. Paste your token
6. Click "Add secret"

### Using the PAT in the Workflow

Update `.github/workflows/assign-reviewers.yml`:

```yaml
- name: Run reviewer assignment script
  env:
    GITHUB_TOKEN: ${{ secrets.REVIEWER_PAT }}  # Use PAT instead of default token
  run: node .github/scripts/assign-reviewers.js
```

Or keep both for testing:

```yaml
- name: Run reviewer assignment script
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GITHUB_PAT: ${{ secrets.REVIEWER_PAT }}  # Script will prefer this if available
  run: node .github/scripts/assign-reviewers.js
```

## Setup Instructions

### 1. Copy Files to Your Repository

```bash
# Copy the entire structure to your repo
cp -r .github/ /path/to/your/repo/.github/
cp CODEOWNERS /path/to/your/repo/CODEOWNERS
cp package.json /path/to/your/repo/package.json
```

### 2. Customize CODEOWNERS

Edit the `CODEOWNERS` file with your actual:
- User handles (e.g., `@alice`, `@bob`)
- Team names (e.g., `@myorg/backend-team`)
- File patterns matching your project structure

### 3. Configure Secrets (if using teams)

Follow the "Adding PAT to Repository Secrets" section above.

### 4. Commit and Push

```bash
git add .github/ CODEOWNERS package.json
git commit -m "Add automatic reviewer assignment from CODEOWNERS"
git push
```

### 5. Test

Create a pull request and watch the action run:
- Check the Actions tab for logs
- Verify reviewers are assigned
- Confirm a comment is posted

## How It Works

### Workflow Trigger
The action runs when a PR is opened or moved to "ready for review":

```yaml
on:
  pull_request:
    types: [opened, ready_for_review]
```

### Process Flow

1. **Checkout code** - Gets repository content including CODEOWNERS
2. **Parse CODEOWNERS** - Reads and parses ownership rules
3. **Get changed files** - Fetches list of files modified in the PR
4. **Match patterns** - Finds code owners for the changed files
5. **Test permissions** - Checks if PAT can access teams
6. **Assign reviewers** - Requests reviews from users and teams
7. **Post comment** - Adds a notification comment mentioning reviewers

### Pattern Matching

The script supports common CODEOWNERS patterns:
- `*` - Matches any file
- `*.js` - Matches all JavaScript files
- `/src/` - Matches files in src directory
- `/src/api/` - Matches files in src/api directory

### Example Output

The script will log detailed information:

```
Processing PR #42 in myorg/myrepo
Using token type: PAT

=== Testing PAT Permissions ===
Authenticated as: bot-user
Can access 1 organizations
✓ PAT can read teams in myorg

=== Parsing CODEOWNERS ===
Found 12 CODEOWNERS rules

=== Getting Changed Files ===
Found 3 changed files

=== Matching Files to Owners ===
File "src/api/users.js" matched pattern "/src/api/"
File "src/api/auth.js" matched pattern "/src/api/"
Identified 2 relevant owners: ['backend-team', 'charlie']

=== Assigning Reviewers ===
Requesting reviews from: { reviewers: ['charlie'], team_reviewers: ['backend-team'] }
✓ Successfully assigned reviewers

=== Adding PR Comment ===
✓ Successfully added comment to PR
```

## Troubleshooting

### Teams Not Being Assigned

**Error:** "✗ Failed to assign reviewers: Resource not accessible by integration"

**Solution:** You need a PAT with `read:org` scope. See "Creating a PAT for Team Access" above.

### Comment Not Posted

**Error:** "✗ Failed to add comment: Resource not accessible by integration"

**Solution:** Ensure your PAT has `repo` scope or use the default `GITHUB_TOKEN`.

### No Reviewers Assigned

**Check:**
1. Does your CODEOWNERS file exist?
2. Do the patterns match your changed files?
3. Are the usernames and team names correct?
4. Check the action logs for pattern matching details

### Testing Locally

You can test the script locally:

```bash
# Install dependencies
npm install

# Set environment variables
export GITHUB_TOKEN="your-pat-here"
export GITHUB_REPOSITORY="owner/repo"
export PR_NUMBER=42

# Run script
node .github/scripts/assign-reviewers.js
```

## Advanced Configuration

### Exclude Draft PRs

Modify the workflow to skip draft PRs:

```yaml
on:
  pull_request:
    types: [opened, ready_for_review]  # Excludes draft PRs
```

### Run on File Changes

Only run when certain files change:

```yaml
on:
  pull_request:
    types: [opened, ready_for_review]
    paths:
      - 'src/**'
      - '!docs/**'
```

### Customize Comment Message

Edit the `addComment` function in `.github/scripts/assign-reviewers.js` to change the comment format.

## Security Considerations

1. **Use fine-grained PATs** when possible for better security
2. **Limit PAT scope** to only what's needed
3. **Rotate PATs regularly** (set expiration dates)
4. **Use organization secrets** for shared workflows
5. **Monitor PAT usage** in your GitHub audit log

## License

This is a proof of concept for demonstration purposes.
