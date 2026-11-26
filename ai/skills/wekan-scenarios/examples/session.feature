@session
Feature: Signing in and out
  Scenario: An account signs in through the form and out again
    Given I am not logged in
    When I log in with the "member" user
    Then I should be logged in as "Member Test"
    When I log out
    Then I should not be logged in

  Scenario: A wrong password is refused
    When I log in as "member" with the password "not-the-right-password"
    Then the login should be refused with "Incorrect password"
    And I should not be logged in
