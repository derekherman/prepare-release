const github = require('@actions/github');
const core = require('@actions/core');
const { cmpTags } = require('tag-cmp');
const compareVersions = require('compare-versions');

async function run() {
  try {
    const octokit = github.getOctokit(process.env['GITHUB_TOKEN']);
    const [ owner, repo ] = process.env['GITHUB_REPOSITORY'].split('/');
    const baseRef = core.getInput('baseRef').trim();
    const headRef = core.getInput('headRef').trim();
    const tagRef = core.getInput('tagRef').trim();
    const changelogMessage = core.getInput('changelogMessage').trim();
    const propsTitle = core.getInput('propsTitle').trim();
    const propsMessage = core.getInput('propsMessage').trim();
    const isPreRelease = ['-a', '-b', '-rc'].some(tag => tagRef.includes(tag))
    const releaseList = [];
    const committersList = [];
    const contributorList = [];
    const changelogList = {
      "breaking change": {
        title: core.getInput('breakingChangeTitle').trim(),
        pulls: [],
      },
      enhancement: {
        title: core.getInput('enhancementTitle').trim(),
        pulls: [],
      },
      bug: {
        title: core.getInput('bugTitle').trim(),
        pulls: [],
      },
      regression: {
        title: core.getInput('regressionTitle').trim(),
        pulls: [],
      },
      test: {
        title: core.getInput('testTitle').trim(),
        pulls: [],
      },
      dependency: {
        title: core.getInput('dependencyTitle').trim(),
        pulls: [],
      },
      documentation: {
        title:core.getInput('documentationTitle').trim(),
        pulls: [],
      },
      unlabeled: {
        title: core.getInput('unlabeledTitle').trim(),
        pulls: [],
      },
    };

    // Get the previous releases.
    const listReleases = await octokit.repos.listReleases.endpoint.merge({
      owner: owner,
      repo: repo,
      direction: 'desc',
      per_page: 100
    });

    // Add releases to the array.
    for await (const page of octokit.paginate.iterator(listReleases)) {
      for (const item of page.data) {
        /**
         * Don't include releases that are newer than the tagRef being created. This means we
         * just merged commits into a release branch that is not the current version i.e
         * a minor release into a 1.0 branch from a 1.x.x or feature branch.
         */
        if (compareVersions.compare(item.tag_name, tagRef, '<')) {
          releaseList.push(item.tag_name);
        }
        /**
         * Can't create the same tag twice and since we can merge into the branch without
         * bumping the version we should bail and let the action handle this by setting
         * `continue-on-error` to `true` and then add a condition to check for success to
         * the release step. This will keep a failed release from failing the entire pipeline.
         */
        if (compareVersions.compare(item.tag_name, tagRef, '=')) {
          throw new Error('The current release already exists. Be sure to bump the version.');
        }
      }
    }

    /**
     * If !isPreRelease && releaseList.length > 0 && has 1 or more prerelease in between, go back to
     * the previous release tag to populate the base. Meaning, if there is an `-a`, `-b`, or `-rc`
     * between releases and we have more tags, loop over them and shift them off the array until we find
     * the last proper release. Or use the first commit sha. Doing this here means we can mutate
     * releaseList and only loop over the commits once, if we have to.
     */
    if (!isPreRelease && releaseList.length > 0) {
      const cloneReleaseList = [
        ...releaseList
      ];
      for (const release of cloneReleaseList) {
        if (['-a', '-b', '-rc'].some(tag => release.includes(tag))) {
          releaseList.shift();
        } else {
          break;
        }
      }
    }

    // Get the first commit on the base branch if there's no releases.
    if (!releaseList.length) {
      const listCommits = await octokit.repos.listCommits.endpoint.merge({
        owner: owner,
        repo: repo,
        ref: baseRef,
        per_page: 100,
      });

      for await (const page of octokit.paginate.iterator(listCommits)) {
        for (const item of page.data) {
          releaseList.push(item.sha);
        }
      }
    } else {
      releaseList.sort(cmpTags).reverse();
    }

    const [ base ] = releaseList.slice(-1);

    // Compare all the commits using baseRef (main) as the HEAD and previous release sha as the base.
    const compareCommits = await octokit.repos.compareCommits({
      owner: owner,
      repo: repo,
      base: base,
      head: baseRef,
    });
    const commits = compareCommits.data.commits || [];

    if (!commits.length) {
      throw new Error('There have been no commits since the last tag.')
    }

    Object.keys(commits).forEach(key => {
      const commit = commits[key];
      if (!commit.author || commit.author.login.includes('renovate-bot')) {
        return;
      }

      // Add committer.
      committersList.push({
        name: commit.commit.author.name,
        login: commit.author.login,
      })
    });

    // Remove the duplicates, sort alphabetically, and push to the contributorList.
    committersList
      .filter((v, i, a) => a.findIndex(t => t.login === v.login) === i)
      .sort((a, b) => (a.name > b.name) ? 1 : -1)
      .forEach(committer => contributorList.push(`${committer.name} (@${committer.login})`));

    const pulls = await octokit.pulls.list({
      owner: owner,
      repo: repo,
      base: headRef,
      state: 'closed',
    });

    const shaList = [];
    const pullList = [];

    for (const commit of commits) {
      shaList.push(commit.sha);
    }

    for (const pull of pulls.data) {
      if (shaList.includes(pull.merge_commit_sha)) {
        pullList.push(pull);
      }
    }

    // Process the pulls.
    for (const pull of pullList) {
      if (!pull.labels.length) {
        changelogList.unlabeled.pulls.push(pull);
      }
      for (const label of pull.labels) {
        if (changelogList[label.name]) {
          changelogList[label.name].pulls.push(pull);
        }
      }
    }

    const contribNum = contributorList.length === 1 ? '`1` contributor' : `\`${contributorList.length}\` contributors`;
    const commitsNum = commits.length === 1 ? '`1` commit' : `\`${commits.length}\` commits`;
    const prNum = pullList.length === 1 ? '`1` pull request' : `\`${pullList.length}\` pull requests`;
    const releaseText = isPreRelease ? 'pre-release' : 'release';

    let changelog = `## Changelog\n\nThe \`${tagRef}\` ${releaseText} contains ${commitsNum} from ${prNum} provided by ${contribNum}. ${changelogMessage}\n`;

    Object.keys(changelogList).forEach(label => {
      if (changelogList[label].pulls.length) {
        changelog += `\n${changelogList[label].title}\n`;
        changelogList[label].pulls.forEach(pull => {
          changelog += `- ${pull.title} #${pull.number}\n`;
        });
      }
    });

    const props = `## ${propsTitle}\n\n${propsMessage}\n\n${contributorList.join(', ')}`;

    core.setOutput('changelog', changelog);
    core.setOutput('props', props);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
