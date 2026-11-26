@roles
Feature: What each account may do on the board
  Scenario: A read-only member reads a card, and neither changes nor comments on it
    Given I am a logged in user with the "reader" user
    When I open the board "Webship site"
    Then I should not be able to add a card to the list "To Do"
    When I open the card "The greeting script says Helo instead of Hello"
    Then I should not be able to change the card
    And I should not be able to comment on the card

  @js-off
  Scenario: An account the board does not have is refused it
    Given I am a logged in user with the "stranger" user
    Then I should be refused the board "Webship site"
