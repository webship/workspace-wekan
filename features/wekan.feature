Feature: The Wekan plugin on the dashboard
  Once the plugin is activated and installed, the sites folders offer the Wekan builder, each AI folder lists the items
  of its kind the plugin ships, the Plugins page lists the plugin with its settings, and the project rows of sites and
  code folders carry the WEKAN menu of cards once a Wekan is connected.

  # Settings lists every plugin that was added; the package and what the plugin ships are on its own page.
  Scenario: Settings lists the plugin, and its own page names its package, what it ships and its settings
    Given I am on "/settings"
     Then I should see "Wekan"
     When I go to "/settings/plugin/wekan"
     Then I should see "@webship.co/workspace-wekan"
      And I should see "cmd-wekan-project.sh"
      And I should see "wekan-site-builder"
      And I should see "Writes to Wekan (cards)"

  Scenario: A sites folder offers the Wekan builder
    Given I am on "/dev"
     Then "option[value='cmd-wekan-project.sh']" should be attached

  # The AI folders are searched by name: with every plugin on, a folder lists more than one page of items.
  Scenario: The AI Agents folder lists the agents the plugin ships
    Given I am on "/ai-agents?q=wekan-"
     Then I should see "wekan-site-builder"
      And I should see "wekan-tester"
      And I should see "wekan-issue-worker"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills?q=wekan-scenarios"
     Then I should see "wekan-scenarios"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands?q=wekan-test"
     Then I should see "wekan-test"

  Scenario: The AI Prompts folder lists the prompts the plugin ships
    Given I am on "/ai-prompts?q=wekan-"
     Then I should see "wekan-build-and-test"
      And I should see "wekan-issue-to-branch"

  # The cards as work items (@webship.co/workspace-tracker). The list asks Wekan again when its View or its filter
  # changes, and Enter submits it. It needs a Wekan with a token, a default board and a project in the dev folder: CI
  # has none, so it skips this, saying why.
  @needs-setting-wekan-token @needs-setting-wekan-default_scope @needs-project-dev
  Scenario: The card list follows its View and its filter
    Given I am on "/dev"
     When I click on the element ".act-menu-wekan > button"
      And I click on the element ".act-menu-wekan a[hx-get*='/tracker/list/']"
     Then eventually I should see "All open cards ·" within 30 seconds
     When I select "My cards" from "view"
     Then eventually I should see "My cards ·" within 30 seconds
     When I select "Search (Wekan's own syntax)" from "view"
      And I fill in "q" with "greting"
      And I press the key "Enter" on the element "input[name=q]"
     Then eventually I should see "\"greting\" · 1 card" within 30 seconds
