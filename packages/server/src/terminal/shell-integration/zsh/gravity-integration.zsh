if [[ -n "${_GRAVITY_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _GRAVITY_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _GRAVITY_ZSH_COMMAND_ACTIVE=0

function _gravity_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _gravity_precmd() {
  local command_status=$?
  if [[ "$_GRAVITY_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _gravity_osc633 "D;${command_status}"
    _GRAVITY_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _gravity_osc633 "A"
}

function _gravity_preexec() {
  _GRAVITY_ZSH_COMMAND_ACTIVE=1
  _gravity_osc633 "B"
  _gravity_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _gravity_precmd
add-zsh-hook preexec _gravity_preexec
