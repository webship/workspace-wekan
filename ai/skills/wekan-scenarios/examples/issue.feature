@cards
Feature: A card worked by a member
  Scenario: A comment, a label, an assignee and a move to another list
    Given there is a card "Webship test work" in the list "To Do" of the board "Webship site"
    And I am a logged in user with the "member" user
    When I open the card "Webship test work"
    And I add the comment "Checked on the test site" to the card
    And I add the label "bug" to the card
    And I assign the card to "Owner Test"
    And I move the card to the list "Doing"
    Then the card should show the comment "Checked on the test site" by "Member Test"
    And the card should have the label "bug"
    And the card should be assigned to "Owner Test"
    And the card should be in the list "Doing"
