@site
Feature: The board of the site
  A first feature of a Wekan site of the Webship Workspace, placed by the testing setup: the site opens on its sign-in
  form, a member reads the sample board, and works a card of its own, which goes after the scenario. It passes on a
  site built with --install --add-users --sample-content; add your own features beside it.

  # A visitor is sent to the sign-in form: the site's sign-up is off.
  Scenario: The site opens on its sign-in form
    Given I am not logged in
    When I go to the homepage
    Then I should see "Sign In"
    And I should see "Forgot your password?"

  Scenario: A member reads the sample board
    Given I am a logged in user with the "member" user
    When I open the board "Webship site"
    Then the list "Doing" should show the card "The greeting script says Helo instead of Hello"
    And the list "To Do" should show the card "The usage line spells greeting as greting"

  Scenario: A member works a card of its own
    Given there is a card "Webship test site" in the list "To Do" of the board "Webship site"
    And I am a logged in user with the "member" user
    When I open the card "Webship test site"
    And I add the comment "Checked on the test site" to the card
    And I move the card to the list "Doing"
    Then the card should show the comment "Checked on the test site" by "Member Test"
    And the card should be in the list "Doing"

  @js-off
  Scenario: An account the board does not have is refused it
    Given I am a logged in user with the "stranger" user
    Then I should be refused the board "Webship site"
