typeset -g GRAVITY_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${GRAVITY_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${GRAVITY_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${GRAVITY_SHELL_INTEGRATION_DIR}/gravity-integration.zsh"
