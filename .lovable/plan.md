# Verification — Label Printing role wiring for `print@brijsweets.in`

## Result: ✅ Correctly mapped, end-to-end

### 1. User → Role assignment
```
email:       print@brijsweets.in
role_id:     e72af6de-…  →  "Label Operator"
property_id: 3077d563-…  (Brij Sweets)
```
The user is scoped to a single property with the `Label Operator` role. ✅

### 2. Role → Permission grants (DB `role_permissions`)
`Label Operator` has all four `label_printing` actions granted:

| Module | view | create | edit | delete |
|---|---|---|---|---|
| label_printing | ✅ | ✅ | ✅ | ✅ |

(Owner role also has all four — expected.)

### 3. RLS policies on label tables
All three tables (`label_products`, `label_print_batches`, `label_company_settings`) use the dynamic `has_permission(auth.uid(), property_id, 'label_printing', <action>)` check:

| Table | SELECT | INSERT (WITH CHECK) | UPDATE | DELETE |
|---|---|---|---|---|
| label_products | view | create | edit | delete |
| label_print_batches | view | create | edit | delete |
| label_company_settings | view | edit | edit | edit |

Policies are per-operation, no legacy `ALL` policies, no hardcoded role checks. ✅

### 4. Frontend gates
- **Sidebar** (`AppShell.tsx:141`): nav item declares `module: "label_printing"` → filtered by `can("label_printing","view")`. Toggling **View OFF** hides the sidebar link.
- **Route guard** (`label-printing.index.tsx:48`): `<RequirePermission module="label_printing">` blocks the page with "Access Denied" if View is off.
- **Action gates inside the page**:
  - New/Add Product button → `can("label_printing","create")`
  - Edit row → `can("label_printing","edit")`
  - Delete row → `can("label_printing","delete")`
  - Company Settings tab save → `canEdit = can("label_printing","edit")`
- **Roles grid** (`superadmin.roles.$id.tsx:58`): "Label Printing" section renders with view/create/edit/delete toggles — matches DB rows.

### 5. What the user will actually see
Signed in as `print@brijsweets.in` (Label Operator, all 4 grants ON):
- Sidebar shows **Label Printing** ✅
- Can open `/label-printing` ✅
- Can add / edit / delete products ✅
- Can print (writes to `label_print_batches`) ✅
- Can save Company Settings ✅
- Every other module hidden (grid confirmed all other modules = OFF).

### 6. Behavior when Owner toggles Label Printing OFF for this role
- Toggle **View OFF** → sidebar hides, direct URL shows Access Denied card (with Sign Out).
- Toggle **Create OFF** → "New Product" button hidden; inserts to `label_products` / `label_print_batches` fail RLS.
- Toggle **Edit OFF** → edit buttons hidden; updates fail RLS; Company Settings save disabled.
- Toggle **Delete OFF** → delete button hidden; deletes fail RLS.

Permission changes take effect on next `usePermissions` refetch (auth event / property switch / page reload).

## Conclusion
No code changes required. The mapping is consistent across `permissions` → `role_permissions` → RLS policies → route guard → in-page action gates → sidebar nav. If you want an end-to-end Playwright confirmation (sign in as this user, verify sidebar + one create + one flip-off), I can run that in build mode.
