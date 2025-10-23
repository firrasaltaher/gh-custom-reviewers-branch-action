# GitHub PAT Scopes Quick Reference

This document explains which GitHub Personal Access Token (PAT) scopes work for team-based reviewer assignment.

## Quick Answer

**For team reviewer assignment, you need:**
- Classic PAT: `repo` + `read:org`
- Fine-grained PAT: Pull requests (read/write) + Members (read)

## Detailed Breakdown

### Classic Personal Access Token Scopes

#### Minimum for Individual Reviewers Only
```
✅ repo
   ✅ repo:status
   ✅ repo_deployment
   ✅ public_repo
   ✅ repo:invite
   ✅ security_events
```

#### Required for Team Reviewers
```
✅ repo (as above)
✅ read:org
   ✅ read:org - Read org and team membership
```

#### Optional but Useful
```
⚪ write:discussion (if you want to interact with discussions)
⚪ read:user (for user profile information)
⚪ user:email (for user email addresses)
```

### Fine-grained Personal Access Token Permissions

#### Repository Permissions (Required)
```
✅ Pull requests: Read and write
   - Needed to: Request reviewers, modify PR assignments
✅ Contents: Read
   - Needed to: Read CODEOWNERS file, list changed files
✅ Metadata: Read
   - Automatically included
```

#### Organization Permissions (Required for Teams)
```
✅ Members: Read
   - Needed to: Resolve team names, assign team reviewers
```

#### Account Permissions
```
⚪ Usually none needed
```

## Testing Your PAT

### Using the POC Script

The script includes a `testPATPermissions()` function that will:
1. Verify authentication
2. Check if you can list organizations
3. Attempt to read team information
4. Report what the PAT can and cannot do

Output example:
```
=== Testing PAT Permissions ===
Authenticated as: my-bot-account
Can access 1 organizations
✓ PAT can read teams in myorg
```

### Manual Testing with GitHub CLI

```bash
# Set your token
export GITHUB_TOKEN="ghp_your_token_here"

# Test basic auth
gh api user

# Test org access (requires read:org)
gh api user/orgs

# Test team access (requires read:org)
gh api orgs/YOUR_ORG/teams

# Test reviewer assignment (requires repo scope)
gh api repos/OWNER/REPO/pulls/PR_NUMBER/requested_reviewers \
  -X POST \
  -f reviewers[]="username" \
  -f team_reviewers[]="teamname"
```

### Using curl

```bash
TOKEN="your-pat-here"
ORG="your-org"
OWNER="repo-owner"
REPO="repo-name"
PR=42

# Test authentication
curl -H "Authorization: token $TOKEN" \
  https://api.github.com/user

# Test org access
curl -H "Authorization: token $TOKEN" \
  https://api.github.com/orgs/$ORG

# Test team listing (requires read:org)
curl -H "Authorization: token $TOKEN" \
  https://api.github.com/orgs/$ORG/teams

# Test assigning reviewers
curl -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR/requested_reviewers \
  -d '{"reviewers":["user1"],"team_reviewers":["team1"]}'
```

## Common Error Messages

### "Resource not accessible by integration"
**Meaning:** Token doesn't have required scopes

**For individual reviewers:**
- Need: `repo` scope (Classic) or Pull requests read/write (Fine-grained)

**For team reviewers:**
- Need: `read:org` scope (Classic) or Members read (Fine-grained)

### "Not Found"
**Possible causes:**
1. Team name is incorrect
2. Team doesn't exist in the organization
3. Token doesn't have `read:org` scope to see the team

### "Validation Failed"
**Possible causes:**
1. User doesn't exist or username is misspelled
2. User doesn't have access to the repository
3. User is already assigned as a reviewer

## Scope Comparison Table

| Capability | Default GITHUB_TOKEN | Classic PAT (repo only) | Classic PAT (repo + read:org) | Fine-grained PAT |
|------------|---------------------|-------------------------|-------------------------------|------------------|
| Read files | ✅ | ✅ | ✅ | ✅ |
| List changed files | ✅ | ✅ | ✅ | ✅ |
| Assign individual reviewers | ✅ | ✅ | ✅ | ✅ |
| Create comments | ✅ | ✅ | ✅ | ✅ |
| List organizations | ❌ | ❌ | ✅ | ✅ |
| List teams | ❌ | ❌ | ✅ | ✅ |
| Assign team reviewers | ❌ | ❌ | ✅ | ✅ |
| Scope limitation | Repo only | Repo only | Repo + Org | Granular |

## Best Practices

### 1. Use Fine-grained PATs When Possible
Fine-grained tokens are more secure because:
- You can limit them to specific repositories
- Permissions are more granular
- They have built-in expiration

### 2. Set Token Expiration
Always set an expiration date:
- 30 days for testing
- 90 days for production
- Never "no expiration" for automated systems

### 3. Use Bot Accounts
For production workflows:
- Create a dedicated bot account
- Generate the PAT from the bot account
- Add the bot to your organization
- Grant minimum necessary permissions

### 4. Rotate Tokens Regularly
- Set up calendar reminders
- Document token rotation procedures
- Have backup tokens ready
- Test new tokens before rotating

### 5. Monitor Token Usage
GitHub provides audit logs for:
- Token usage
- Failed authentication attempts
- Scope escalation attempts
- Unusual API patterns

### 6. Store Tokens Securely
- Never commit tokens to git
- Use GitHub Secrets for Actions
- Use environment variables locally
- Consider using a secrets manager

## Debugging Checklist

When team assignment fails:

- [ ] Is the PAT stored in repository secrets?
- [ ] Does the PAT have `read:org` scope (Classic)?
- [ ] Does the PAT have Members:Read permission (Fine-grained)?
- [ ] Is the team name correct in CODEOWNERS?
- [ ] Is the team in the same org as the repository?
- [ ] Is the bot account a member of the organization?
- [ ] Has the PAT expired?
- [ ] Are you using the right token in the workflow?

## Getting Help

If you're still having issues:

1. Check the GitHub Actions logs
2. Look for specific error messages
3. Verify PAT scopes in GitHub Settings
4. Test the PAT manually with curl
5. Check GitHub's API documentation
6. Review your organization's security settings

## References

- [GitHub PAT Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GitHub API - Request Reviewers](https://docs.github.com/en/rest/pulls/review-requests)
- [CODEOWNERS Syntax](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
