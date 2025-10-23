const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const { minimatch } = require('minimatch');

// Initialize Octokit with either GITHUB_PAT or GITHUB_TOKEN
const token = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: token });

// Get PR context from GitHub Actions environment
const context = {
  owner: process.env.GITHUB_REPOSITORY.split('/')[0],
  repo: process.env.GITHUB_REPOSITORY.split('/')[1],
  pull_number: parseInt(process.env.GITHUB_EVENT_PATH ?
    JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request.number :
    process.env.PR_NUMBER)
};

console.log(`Processing PR #${context.pull_number} in ${context.owner}/${context.repo}`);
console.log(`Using token type: ${process.env.GITHUB_PAT ? 'PAT' : 'GITHUB_TOKEN'}`);

/**
 * Find CODEOWNERS file in standard locations
 * GitHub supports: root, .github/, and docs/
 */
function findCodeownersPath() {
  const possiblePaths = [
    path.join(process.cwd(), 'CODEOWNERS'),
    path.join(process.cwd(), '.github', 'CODEOWNERS'),
    path.join(process.cwd(), 'docs', 'CODEOWNERS')
  ];

  for (const codePath of possiblePaths) {
    if (fs.existsSync(codePath)) {
      console.log(`Found CODEOWNERS at: ${codePath}`);
      return codePath;
    }
  }

  return null;
}

/**
 * Parse CODEOWNERS file
 * Format: pattern @owner1 @owner2 @org/team
 */
function parseCodeowners(codeownersPath) {
  if (!codeownersPath || !fs.existsSync(codeownersPath)) {
    console.log('No CODEOWNERS file found');
    return [];
  }

  const content = fs.readFileSync(codeownersPath, 'utf8');
  const lines = content.split('\n');
  const rules = [];

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse pattern and owners
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const pattern = parts[0];
    const owners = parts.slice(1).map(owner => owner.replace('@', ''));

    rules.push({ pattern, owners });
  }

  return rules;
}

/**
 * Get files changed in the PR
 */
async function getChangedFiles() {
  const { data: files } = await octokit.pulls.listFiles({
    ...context,
  });

  return files.map(file => file.filename);
}

/**
 * Match files to CODEOWNERS patterns using proper glob matching
 * Supports: *, **, ?, [abc], {js,ts}, and negation patterns
 */
function matchPattern(pattern, filePath) {
  // Remove leading slash for minimatch (it treats paths as relative)
  let matchPattern = pattern.startsWith('/') ? pattern.substring(1) : pattern;

  // For patterns without leading slash, match anywhere in path (matchBase: true)
  const options = {
    dot: true,  // Match files starting with .
    matchBase: !pattern.startsWith('/'),  // Allow matching anywhere if no leading /
    nocomment: true,  // Don't treat # as comments
  };

  return minimatch(filePath, matchPattern, options);
}

/**
 * Get relevant code owners for changed files
 */
function getRelevantOwners(changedFiles, codeownersRules) {
  const owners = new Set();

  for (const file of changedFiles) {
    // Find matching rules (check from end to start, as later rules override)
    for (let i = codeownersRules.length - 1; i >= 0; i--) {
      const rule = codeownersRules[i];
      if (matchPattern(rule.pattern, file)) {
        console.log(`File "${file}" matched pattern "${rule.pattern}"`);
        rule.owners.forEach(owner => owners.add(owner));
        break; // Use the most specific (last) matching rule
      }
    }
  }

  return Array.from(owners);
}

/**
 * Get PR author to filter them out from reviewers
 */
async function getPRAuthor() {
  try {
    const { data: pr } = await octokit.pulls.get(context);
    return pr.user.login;
  } catch (error) {
    console.error('Failed to get PR author:', error.message);
    return null;
  }
}

/**
 * Separate individual reviewers and teams, filtering out PR author
 */
function separateReviewersAndTeams(owners, prAuthor) {
  const reviewers = [];
  const teams = [];

  for (const owner of owners) {
    if (owner.includes('/')) {
      // Team format: org/team - extract team slug
      const parts = owner.split('/');
      if (parts.length >= 2) {
        teams.push(parts[parts.length - 1]); // Handle multi-slash team names
      }
    } else {
      // Individual user - skip if they're the PR author
      if (owner !== prAuthor) {
        reviewers.push(owner);
      } else {
        console.log(`Skipping PR author ${owner} from reviewers`);
      }
    }
  }

  // Remove duplicates
  return {
    reviewers: [...new Set(reviewers)],
    teams: [...new Set(teams)]
  };
}

/**
 * Test PAT permissions for team access
 */
async function testPATPermissions() {
  try {
    // Try to get authenticated user info
    const { data: user } = await octokit.users.getAuthenticated();
    console.log(`Authenticated as: ${user.login}`);

    // Try to get organization info (requires specific scopes)
    try {
      const { data: orgs } = await octokit.orgs.listForAuthenticatedUser();
      console.log(`Can access ${orgs.length} organizations`);

      // Check if we can read team memberships
      if (orgs.length > 0) {
        try {
          const { data: teams } = await octokit.teams.list({
            org: orgs[0].login
          });
          console.log(`✓ PAT can read teams in ${orgs[0].login}`);
          return { canAccessTeams: true, org: orgs[0].login };
        } catch (error) {
          console.log(`✗ PAT cannot read teams: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`✗ PAT cannot list organizations: ${error.message}`);
    }
  } catch (error) {
    console.log(`✗ Authentication failed: ${error.message}`);
  }

  return { canAccessTeams: false };
}

/**
 * Assign reviewers to PR with separate API calls for better error handling
 */
async function assignReviewers(reviewers, teams) {
  let individualsSuccess = false;
  let teamsSuccess = false;
  const errors = [];

  // Try to assign individual reviewers first
  if (reviewers.length > 0) {
    try {
      await octokit.pulls.requestReviewers({
        ...context,
        reviewers: reviewers
      });
      console.log(`✓ Successfully assigned ${reviewers.length} individual reviewer(s)`);
      individualsSuccess = true;
    } catch (error) {
      console.error(`✗ Failed to assign individual reviewers: ${error.message}`);
      errors.push(`Individual reviewers: ${error.message}`);
    }
  }

  // Try to assign team reviewers separately
  if (teams.length > 0) {
    try {
      await octokit.pulls.requestReviewers({
        ...context,
        team_reviewers: teams
      });
      console.log(`✓ Successfully assigned ${teams.length} team reviewer(s)`);
      teamsSuccess = true;
    } catch (error) {
      console.error(`✗ Failed to assign team reviewers: ${error.message}`);

      // Provide helpful error message if it's a permission issue
      if (error.message.includes('Resource not accessible') ||
          error.message.includes('global id') ||
          error.status === 422) {
        console.error('💡 This usually means the GitHub token lacks organization permissions.');
        console.error('   To assign team reviewers, use a PAT with "read:org" and "repo" scopes.');
        errors.push('Team reviewers: Insufficient permissions (need PAT with read:org scope)');
      } else {
        errors.push(`Team reviewers: ${error.message}`);
      }
    }
  }

  return {
    success: individualsSuccess || teamsSuccess,
    individualsSuccess,
    teamsSuccess,
    errors
  };
}

/**
 * Add comment to PR with detailed status information
 */
async function addComment(reviewers, teams, assignmentResult) {
  const { individualsSuccess, teamsSuccess, errors } = assignmentResult;

  let body = '## 🔔 Code Review Assignment\n\n';
  body += 'Based on the CODEOWNERS file, reviewers have been processed:\n\n';

  // Individual reviewers section
  if (reviewers.length > 0) {
    const individualMentions = reviewers.map(r => `@${r}`).join(', ');
    const status = individualsSuccess ? '✓' : '✗';
    body += `${status} **Individual Reviewers:** ${individualMentions}\n`;
  }

  // Team reviewers section
  if (teams.length > 0) {
    const teamMentions = teams.map(t => `@${context.owner}/${t}`).join(', ');
    const status = teamsSuccess ? '✓' : '✗';
    body += `${status} **Team Reviewers:** ${teamMentions}\n`;

    if (!teamsSuccess) {
      body += '\n⚠️ **Team Assignment Failed**\n';
      body += 'Team reviewers require a Personal Access Token (PAT) with the following scopes:\n';
      body += '- `repo` (Full control of private repositories)\n';
      body += '- `read:org` (Read organization membership)\n\n';
      body += 'The default `GITHUB_TOKEN` cannot assign team reviewers due to GitHub API limitations.\n';
      body += 'See the [documentation](https://docs.github.com/en/rest/pulls/review-requests) for more details.\n';
    }
  }

  // Add errors if any
  if (errors.length > 0 && !individualsSuccess && !teamsSuccess) {
    body += '\n### ❌ Assignment Errors\n\n';
    errors.forEach(err => body += `- ${err}\n`);
  }

  body += '\n---\n*This PR has been automatically processed based on CODEOWNERS.*';

  try {
    await octokit.issues.createComment({
      ...context,
      body
    });
    console.log('✓ Successfully added comment to PR');
  } catch (error) {
    console.error(`✗ Failed to add comment: ${error.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Test PAT permissions
    console.log('\n=== Testing PAT Permissions ===');
    const permissions = await testPATPermissions();

    // Parse CODEOWNERS from standard locations
    console.log('\n=== Locating and Parsing CODEOWNERS ===');
    const codeownersPath = findCodeownersPath();
    const rules = parseCodeowners(codeownersPath);

    if (rules.length === 0) {
      console.log('No CODEOWNERS rules found. Exiting.');
      return;
    }

    console.log(`Found ${rules.length} CODEOWNERS rules`);

    // Get changed files
    console.log('\n=== Getting Changed Files ===');
    const changedFiles = await getChangedFiles();
    console.log(`Found ${changedFiles.length} changed files`);

    if (changedFiles.length === 0) {
      console.log('No changed files in this PR. Exiting.');
      return;
    }

    // Get relevant owners
    console.log('\n=== Matching Files to Owners ===');
    const owners = getRelevantOwners(changedFiles, rules);
    console.log(`Identified ${owners.length} relevant owners:`, owners);

    if (owners.length === 0) {
      console.log('No owners found for changed files. Exiting.');
      return;
    }

    // Get PR author to filter them out
    console.log('\n=== Getting PR Author ===');
    const prAuthor = await getPRAuthor();
    if (prAuthor) {
      console.log(`PR author: ${prAuthor}`);
    }

    // Separate reviewers and teams, filtering out PR author
    const { reviewers, teams } = separateReviewersAndTeams(owners, prAuthor);
    console.log(`Individual reviewers: ${reviewers.length}, Teams: ${teams.length}`);

    if (reviewers.length === 0 && teams.length === 0) {
      console.log('No reviewers to assign after filtering. Exiting.');
      return;
    }

    // Check if we need team access
    if (teams.length > 0 && !permissions.canAccessTeams) {
      console.log('\n⚠️  WARNING: Teams found but PAT may not have required scopes');
      console.log('Required scopes for team access: read:org, repo');
      console.log('Team assignment will likely fail with the default GITHUB_TOKEN');
    }

    // Assign reviewers
    console.log('\n=== Assigning Reviewers ===');
    const assignmentResult = await assignReviewers(reviewers, teams);

    // Add comment
    console.log('\n=== Adding PR Comment ===');
    await addComment(reviewers, teams, assignmentResult);

    console.log('\n=== Complete ===');
    if (assignmentResult.success) {
      console.log('✓ Action completed successfully');
    } else {
      console.log('✗ Action completed with errors (see logs above)');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();
