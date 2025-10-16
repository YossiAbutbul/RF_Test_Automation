def find_and_print_number(input_string):
    found_digits = []
    for char in input_string:
        if char.isdigit():
            found_digits.append(char)
    
    if found_digits:
        number_str = "".join(found_digits)
        print(f"The string contains the number: {number_str}")
    else:
        print("No number found in the string.")

# Example usage:
my_string1 = "The answer is 42."
find_and_print_number(my_string1)

my_string2 = "No numbers here."
find_and_print_number(my_string2)

my_string3 = "There are 123 apples and 45 oranges."
find_and_print_number(my_string3)