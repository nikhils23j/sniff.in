import { useState, type Ref } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
  maxCount?: number;
  right?: React.ReactNode;
  ref?: Ref<React.ComponentRef<typeof TextInput>>;
};

export function TextField({ label, error, hint, maxCount, right, style, multiline, value, onFocus, onBlur, ref, ...rest }: TextFieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? t.colors.danger : focused ? t.colors.primary : t.colors.borderStrong;
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="caption" color="textSecondary" nativeID={`${label}-label`}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', backgroundColor: t.colors.surface,
          borderWidth: focused || error ? 1.5 : 1, borderColor, borderRadius: t.radius.md, paddingHorizontal: 14,
        }}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={label ? `${label}-label` : undefined}
          placeholderTextColor={t.colors.textTertiary}
          selectionColor={t.colors.primary}
          multiline={multiline}
          value={value}
          maxLength={maxCount}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            t.typography.body,
            {
              flex: 1, color: t.colors.text, paddingVertical: multiline ? 12 : 0, minHeight: multiline ? 96 : 48,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
          {...rest}
        />
        {right}
      </View>
      {error || hint || maxCount ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="caption" color={error ? 'danger' : 'textTertiary'} style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {error ?? hint ?? ''}
          </Text>
          {maxCount ? (
            <Text variant="caption" color="textTertiary">
              {(value?.length ?? 0)}/{maxCount}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** react-hook-form binding for TextField. */
export function FormField<T extends FieldValues>({
  control, name, ...props
}: Omit<TextFieldProps, 'value' | 'onChangeText'> & { control: Control<T>; name: FieldPath<T> }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...props}
          value={(field.value as string | undefined) ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
